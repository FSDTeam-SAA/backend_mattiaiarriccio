import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';

const AI_BACKEND_BASE_URL =
  process.env.AI_BACKEND_BASE_URL || 'https://mattiaiaricco-ai-chatbot.onrender.com';
const AI_TIMEOUT_MS = Number.parseInt(process.env.AI_TIMEOUT_MS || '30000', 10);

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();

      throw new ApiError(
        StatusCodes.BAD_GATEWAY,
        `AI backend request failed with ${response.status}: ${errorBody || response.statusText}`
      );
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(StatusCodes.GATEWAY_TIMEOUT, 'AI backend request timed out');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const getAiServiceInfo = () => ({
  baseUrl: AI_BACKEND_BASE_URL,
  docsUrl: `${AI_BACKEND_BASE_URL}/docs`
});

export const requestAiReply = async ({ userId, query }) => {
  const body = new URLSearchParams({
    user_id: userId,
    query
  });

  const response = await fetchJson(`${AI_BACKEND_BASE_URL}/api/chat/`, {
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
  const response = await fetchJson(`${AI_BACKEND_BASE_URL}/admin/prompt`);

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

  const response = await fetchJson(`${AI_BACKEND_BASE_URL}/admin/prompt`, {
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
