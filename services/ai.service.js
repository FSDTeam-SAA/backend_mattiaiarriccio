import OpenAI from 'openai';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import PromptConfig from '../models/promptConfig.model.js';
import {
  DEFAULT_WELCOME_MESSAGE,
  DEFAULT_SYSTEM_INSTRUCTION,
  DEFAULT_FALLBACK_RESPONSE,
  buildSystemMessage,
  buildOfflineEmergencyGuide,
  languageInstructionFor,
  normalizeLanguage
} from './aiPrompts.js';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
export const DEFAULT_AI_EMERGENCY_TYPE = 'General Emergency';

let openaiClient = null;
let warnedMissingKey = false;

const getOpenAIClient = () => {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (!warnedMissingKey) {
      console.error(
        '[ai.service] ❌ OPENAI_API_KEY is missing. ' +
          'Create a .env file in the project root with OPENAI_API_KEY=sk-... ' +
          '(optionally OPENAI_MODEL). All AI requests will return the offline fallback until this is set.'
      );
      warnedMissingKey = true;
    }
    const error = new Error('OPENAI_API_KEY is not configured');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }

  console.log(`[ai.service] ✅ OpenAI client initialised (model=${OPENAI_MODEL})`);
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

  const offlineFallback = () => {
    const reply =
      buildOfflineEmergencyGuide({
        emergencyType: resolvedEmergencyType,
        language: lang
      }) ||
      config.fallbackMessage ||
      DEFAULT_FALLBACK_RESPONSE;

    return {
      reply,
      raw: {
        id: null,
        model: 'offline-emergency-guide'
      },
      degraded: true
    };
  };

  try {
    const client = getOpenAIClient();
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: 1500,
      reasoning_effort: 'minimal',
      verbosity: 'low'
    });

    const reply = completion?.choices?.[0]?.message?.content || '';
    const elapsedMs = Date.now() - startedAt;

    if (!reply.trim()) {
      console.warn(
        `[ai.service] ⚠️ OpenAI returned empty reply in ${elapsedMs}ms ` +
          `(model=${completion?.model || OPENAI_MODEL}, id=${completion?.id || 'n/a'}, ` +
          `finish=${completion?.choices?.[0]?.finish_reason || 'n/a'}) — serving offline fallback.`
      );
      return offlineFallback();
    }

    console.log(
      `[ai.service] ✅ OpenAI reply ok (model=${completion?.model || OPENAI_MODEL}, ` +
        `id=${completion?.id || 'n/a'}, ${elapsedMs}ms, ${reply.length} chars)`
    );

    return {
      reply,
      raw: {
        id: completion?.id,
        model: completion?.model || OPENAI_MODEL
      }
    };
  } catch (error) {
    const upstreamMessage =
      error?.error?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      'OpenAI request failed';

    const status = error?.status || error?.response?.status || 'n/a';
    const code = error?.code || error?.error?.code || error?.name || 'unknown';
    const type = error?.type || error?.error?.type || 'n/a';

    console.error(
      `[ai.service] ❌ AI provider request failed → falling back to offline guide\n` +
        `  • model:   ${OPENAI_MODEL}\n` +
        `  • code:    ${code}\n` +
        `  • status:  ${status}\n` +
        `  • type:    ${type}\n` +
        `  • message: ${upstreamMessage}`
    );

    if (process.env.AI_DEBUG === '1' && error?.stack) {
      console.error('[ai.service] stack:', error.stack);
    }

    return offlineFallback();
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
