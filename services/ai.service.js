import OpenAI from 'openai';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import PromptConfig from '../models/promptConfig.model.js';
import {
  DEFAULT_WELCOME_MESSAGE,
  DEFAULT_SYSTEM_INSTRUCTION,
  DEFAULT_FALLBACK_RESPONSE,
  buildSystemMessage,
  languageInstructionFor,
  normalizeLanguage
} from './aiPrompts.js';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
export const DEFAULT_AI_EMERGENCY_TYPE = 'General Emergency';

let openaiClient = null;

const getOpenAIClient = () => {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'OPENAI_API_KEY is not configured'
    );
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
};

const readPromptConfig = async () => {
  const doc = await PromptConfig.findOne({ type: 'global_prompt' }).lean();

  return {
    welcomeInstruction:
      (doc && doc.welcome_instruction) || DEFAULT_WELCOME_MESSAGE,
    systemInstruction:
      (doc && doc.system_instruction) || DEFAULT_SYSTEM_INSTRUCTION,
    fallbackMessage:
      (doc && doc.fallback_message) || DEFAULT_FALLBACK_RESPONSE
  };
};

const normalizeEmergencyType = (value) => {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
  return cleaned || DEFAULT_AI_EMERGENCY_TYPE;
};

export const getAiServiceInfo = () => ({
  mode: 'embedded',
  provider: 'openai',
  model: OPENAI_MODEL,
  baseUrl: null,
  docsUrl: null
});

export const requestAiReply = async ({
  query,
  emergencyType,
  language
}) => {
  const config = await readPromptConfig();
  const resolvedEmergencyType = normalizeEmergencyType(emergencyType);
  const lang = normalizeLanguage(language);

  const systemMessage = buildSystemMessage({
    systemInstruction: config.systemInstruction,
    welcomeInstruction: config.welcomeInstruction,
    fallbackMessage: config.fallbackMessage,
    languageInstruction: languageInstructionFor(lang),
    emergencyType: resolvedEmergencyType
  });

  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: String(query || '') }
  ];

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: 300,
      reasoning_effort: 'minimal',
      verbosity: 'low'
    });

    const reply = completion?.choices?.[0]?.message?.content || '';

    return {
      reply,
      raw: {
        id: completion?.id,
        model: completion?.model || OPENAI_MODEL
      }
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;

    const upstreamMessage =
      error?.error?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      'OpenAI request failed';

    throw new ApiError(
      StatusCodes.BAD_GATEWAY,
      `AI backend: ${upstreamMessage}`
    );
  }
};

export const fetchAiPrompt = async () => {
  const config = await readPromptConfig();

  return {
    welcomeMessage: config.welcomeInstruction,
    systemInstruction: config.systemInstruction,
    fallbackMessage: config.fallbackMessage,
    raw: {
      welcome_instruction: config.welcomeInstruction,
      system_instruction: config.systemInstruction,
      fallback_message: config.fallbackMessage
    }
  };
};

export const updateAiPrompt = async ({
  welcomeMessage,
  systemInstruction,
  fallbackMessage
}) => {
  const update = { updated_at: new Date() };

  if (welcomeMessage !== undefined) {
    update.welcome_instruction = welcomeMessage;
  }
  if (systemInstruction !== undefined) {
    update.system_instruction = systemInstruction;
  }
  if (fallbackMessage !== undefined) {
    update.fallback_message = fallbackMessage;
  }

  await PromptConfig.updateOne(
    { type: 'global_prompt' },
    { $set: update, $setOnInsert: { type: 'global_prompt' } },
    { upsert: true }
  );

  return fetchAiPrompt();
};
