import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';

const AI_BACKEND_BASE_URL = String(process.env.AI_BACKEND_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const AI_TIMEOUT_MS = Number.parseInt(process.env.AI_TIMEOUT_MS || '60000', 10);
const AI_RETRY_COUNT = Number.parseInt(process.env.AI_RETRY_COUNT || '1', 10);
const AI_RETRY_DELAY_MS = Number.parseInt(process.env.AI_RETRY_DELAY_MS || '1500', 10);
export const DEFAULT_AI_EMERGENCY_TYPE = 'General Emergency';
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const truncate = (value, maxLength = 240) => {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const extractUpstreamJsonMessage = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const directMessage = [
    payload.message,
    payload.error,
    payload.detail,
    payload.reply
  ].find((value) => typeof value === 'string' && value.trim());

  if (directMessage) {
    return directMessage;
  }

  if (Array.isArray(payload.detail)) {
    return payload.detail
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (entry && typeof entry === 'object') {
          return entry.msg || entry.message || '';
        }

        return '';
      })
      .filter(Boolean)
      .join(', ');
  }

  return '';
};

const formatUpstreamErrorMessage = (response, errorBody) => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const statusLabel = `AI backend returned ${response.status}${
    response.statusText ? ` ${response.statusText}` : ''
  }`;
  const trimmedBody = String(errorBody || '').trim();

  if (!trimmedBody) {
    return statusLabel;
  }

  const looksJson =
    contentType.includes('application/json') ||
    trimmedBody.startsWith('{') ||
    trimmedBody.startsWith('[');

  if (looksJson) {
    try {
      const parsedBody = JSON.parse(trimmedBody);
      const parsedMessage = extractUpstreamJsonMessage(parsedBody);

      if (parsedMessage) {
        return `${statusLabel}: ${truncate(parsedMessage)}`;
      }
    } catch {
      // Fall through to plain-text handling when the upstream body is not valid JSON.
    }
  }

  const looksHtml =
    contentType.includes('text/html') ||
    /^<!doctype html>/i.test(trimmedBody) ||
    /^<html/i.test(trimmedBody);

  if (looksHtml) {
    return `${statusLabel}. The upstream service returned an HTML error page.`;
  }

  return `${statusLabel}: ${truncate(trimmedBody)}`;
};

const shouldRetryNetworkError = (error) => {
  const networkCode = error?.cause?.code || error?.code;

  return RETRYABLE_NETWORK_ERROR_CODES.has(networkCode);
};

const getAiBackendBaseUrl = () => {
  if (!AI_BACKEND_BASE_URL) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'AI_BACKEND_BASE_URL is not configured'
    );
  }

  return AI_BACKEND_BASE_URL;
};

const fetchJson = async (url, options = {}) => {
  const maxAttempts = Math.max(1, AI_RETRY_COUNT + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const formattedMessage = formatUpstreamErrorMessage(response, errorBody);

        if (
          attempt < maxAttempts &&
          RETRYABLE_STATUS_CODES.has(response.status)
        ) {
          await sleep(AI_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw new ApiError(StatusCodes.BAD_GATEWAY, formattedMessage);
      }

      try {
        return await response.json();
      } catch {
        throw new ApiError(
          StatusCodes.BAD_GATEWAY,
          'AI backend returned a non-JSON success response'
        );
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError(StatusCodes.GATEWAY_TIMEOUT, 'AI backend request timed out');
      }

      if (error instanceof ApiError) {
        throw error;
      }

      if (attempt < maxAttempts && shouldRetryNetworkError(error)) {
        await sleep(AI_RETRY_DELAY_MS * attempt);
        continue;
      }

      throw new ApiError(
        StatusCodes.BAD_GATEWAY,
        'AI backend request failed before a response was received'
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ApiError(StatusCodes.BAD_GATEWAY, 'AI backend request failed');
};

export const getAiServiceInfo = () => ({
  baseUrl: AI_BACKEND_BASE_URL || null,
  docsUrl: AI_BACKEND_BASE_URL ? `${AI_BACKEND_BASE_URL}/docs` : null
});

export const requestAiReply = async ({ userId, query, emergencyType }) => {
  const aiBaseUrl = getAiBackendBaseUrl();
  const resolvedEmergencyType =
    String(emergencyType || '')
      .trim()
      .replace(/\s+/g, ' ') || DEFAULT_AI_EMERGENCY_TYPE;
  const body = new URLSearchParams({
    user_id: userId,
    query,
    emergency_type: resolvedEmergencyType
  });

  const response = await fetchJson(`${aiBaseUrl}/api/chat/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  return {
    raw: response,
    reply: response.reply || response.message || ''
  };
};

export const fetchAiPrompt = async () => {
  const aiBaseUrl = getAiBackendBaseUrl();
  const response = await fetchJson(`${aiBaseUrl}/admin/prompt`);

  return {
    welcomeMessage: response.welcome_message || response.welcome_instruction || '',
    systemInstruction: response.system_instruction || '',
    fallbackMessage: response.fallback_message || '',
    raw: response
  };
};

export const updateAiPrompt = async ({
  welcomeMessage,
  systemInstruction,
  fallbackMessage
}) => {
  const aiBaseUrl = getAiBackendBaseUrl();
  const body = new URLSearchParams();

  if (welcomeMessage !== undefined) {
    body.set('welcome_message', welcomeMessage);
  }

  if (systemInstruction !== undefined) {
    body.set('system_instruction', systemInstruction);
  }

  if (fallbackMessage !== undefined) {
    body.set('fallback_message', fallbackMessage);
  }

  const response = await fetchJson(`${aiBaseUrl}/admin/prompt`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  return {
    welcomeMessage: response.welcome_message || response.welcome_instruction || '',
    systemInstruction: response.system_instruction || '',
    fallbackMessage: response.fallback_message || '',
    raw: response
  };
};
