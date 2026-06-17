import OpenAI from 'openai';
import PromptConfig from '../models/promptConfig.model.js';
import { getSetting } from './settings.service.js';
import { isPremiumUser } from './premium.service.js';
import {
  defaultWelcomeFor,
  defaultSystemInstructionFor,
  defaultFallbackFor,
  buildSystemMessage,
  buildOfflineEmergencyGuide,
  languageInstructionFor,
  normalizeLanguage
} from './aiPrompts.js';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
export const DEFAULT_AI_EMERGENCY_TYPE = 'General Emergency';

// Tier-specific output caps. Premium gets a larger budget for richer guidance.
const FREE_MAX_TOKENS = 600;
const PREMIUM_MAX_TOKENS = 1500;

let openaiClient = null;
let warnedMissingKey = false;

const getOpenAIClient = () => {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (!warnedMissingKey) {
      console.error(
        '[ai.service] OPENAI_API_KEY is missing. ' +
          'Create a .env file in the project root with OPENAI_API_KEY=sk-... ' +
          '(optionally OPENAI_MODEL). All AI requests will return the offline fallback until this is set.'
      );
      warnedMissingKey = true;
    }
    const error = new Error('OPENAI_API_KEY is not configured');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }

  console.log(`[ai.service] OpenAI client initialised (model=${OPENAI_MODEL})`);
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
};

const PROMPT_CONFIG_TTL_MS = 60_000;
const promptConfigCache = new Map();

const invalidatePromptConfigCache = () => {
  promptConfigCache.clear();
};

const readPromptConfig = async (language) => {
  const lang = normalizeLanguage(language);
  const cached = promptConfigCache.get(lang);
  const now = Date.now();
  if (cached && now < cached.expiry) {
    return cached.value;
  }

  const doc = await PromptConfig.findOne({
    type: 'global_prompt',
    language: lang
  }).lean();

  const value = {
    welcomeInstruction:
      (doc && doc.welcome_instruction) || defaultWelcomeFor(lang),
    systemInstruction:
      (doc && doc.system_instruction) || defaultSystemInstructionFor(lang),
    fallbackMessage:
      (doc && doc.fallback_message) || defaultFallbackFor(lang)
  };
  promptConfigCache.set(lang, { value, expiry: now + PROMPT_CONFIG_TTL_MS });

  return value;
};

const normalizeEmergencyType = (value) => {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
  return cleaned || DEFAULT_AI_EMERGENCY_TYPE;
};

/**
 * Resolves the tier-specific chat configuration for a caller.
 *
 * - systemPrompt: the admin-editable Settings.premiumPrompt (premium users) or
 *   Settings.freePrompt (free users). If that Settings value is empty, callers
 *   should fall back to the per-language system instruction this module builds.
 * - model: from env OPENAI_MODEL (unchanged from existing behaviour).
 * - maxTokens: premium gets a higher cap than free.
 *
 * @param {object|null} user - req.auth.user (or null for anonymous/internal use)
 * @returns {Promise<{ systemPrompt: string, model: string, maxTokens: number }>}
 */
export const resolvePromptConfig = async (user) => {
  const premium = isPremiumUser(user);

  let systemPrompt = '';
  try {
    systemPrompt = await getSetting(premium ? 'premiumPrompt' : 'freePrompt');
  } catch (error) {
    console.error(
      '[ai.service] Failed to read tier prompt from settings; falling back to defaults:',
      error?.message || error
    );
    systemPrompt = '';
  }

  return {
    systemPrompt: typeof systemPrompt === 'string' ? systemPrompt.trim() : '',
    model: OPENAI_MODEL,
    maxTokens: premium ? PREMIUM_MAX_TOKENS : FREE_MAX_TOKENS
  };
};

const buildAiRequest = async ({ query, emergencyType, language, caller }) => {
  const lang = normalizeLanguage(language);
  const config = await readPromptConfig(lang);
  const hasExplicitEmergencyType = Boolean(String(emergencyType || '').trim());
  const resolvedEmergencyType = normalizeEmergencyType(emergencyType);

  const promptConfig = await resolvePromptConfig(caller);

  // Tier prompt (Settings.freePrompt/premiumPrompt) overrides the per-language
  // base instruction when set; otherwise fall back to the existing instruction.
  const systemInstruction =
    promptConfig.systemPrompt || config.systemInstruction;

  const systemMessage = buildSystemMessage({
    systemInstruction,
    welcomeInstruction: config.welcomeInstruction,
    fallbackMessage: config.fallbackMessage,
    languageInstruction: languageInstructionFor(lang),
    emergencyType: resolvedEmergencyType,
    includeWelcome: !hasExplicitEmergencyType
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
      defaultFallbackFor(lang);

    return {
      reply,
      raw: {
        id: null,
        model: 'offline-emergency-guide'
      },
      degraded: true
    };
  };

  return { messages, offlineFallback, maxTokens: promptConfig.maxTokens };
};

const logAiProviderError = (error) => {
  const upstreamMessage =
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    'OpenAI request failed';

  const status = error?.status || error?.response?.status || 'n/a';
  const code = error?.code || error?.error?.code || error?.name || 'unknown';
  const type = error?.type || error?.error?.type || 'n/a';

  console.error(
    `[ai.service] AI provider request failed; falling back to offline guide\n` +
      `  model:   ${OPENAI_MODEL}\n` +
      `  code:    ${code}\n` +
      `  status:  ${status}\n` +
      `  type:    ${type}\n` +
      `  message: ${upstreamMessage}`
  );

  if (process.env.AI_DEBUG === '1' && error?.stack) {
    console.error('[ai.service] stack:', error.stack);
  }
};

const streamFallbackText = async (text, onDelta) => {
  const words = String(text || '').match(/\S+\s*/g) || [];
  for (const word of words) {
    await onDelta(word);
  }
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
  language,
  caller = null
}) => {
  const { messages, offlineFallback, maxTokens } = await buildAiRequest({
    query,
    emergencyType,
    language,
    caller
  });

  try {
    const client = getOpenAIClient();
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: maxTokens,
      reasoning_effort: 'minimal',
      verbosity: 'low'
    });

    const reply = completion?.choices?.[0]?.message?.content || '';
    const elapsedMs = Date.now() - startedAt;

    if (!reply.trim()) {
      console.warn(
        `[ai.service] OpenAI returned empty reply in ${elapsedMs}ms ` +
          `(model=${completion?.model || OPENAI_MODEL}, id=${completion?.id || 'n/a'}, ` +
          `finish=${completion?.choices?.[0]?.finish_reason || 'n/a'}); serving offline fallback.`
      );
      return offlineFallback();
    }

    console.log(
      `[ai.service] OpenAI reply ok (model=${completion?.model || OPENAI_MODEL}, ` +
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
    logAiProviderError(error);
    return offlineFallback();
  }
};

export const requestAiReplyStream = async ({
  query,
  emergencyType,
  language,
  onDelta,
  caller = null
}) => {
  const { messages, offlineFallback, maxTokens } = await buildAiRequest({
    query,
    emergencyType,
    language,
    caller
  });
  const emitDelta = typeof onDelta === 'function' ? onDelta : async () => {};
  let emittedAnyDelta = false;

  try {
    const client = getOpenAIClient();
    const startedAt = Date.now();
    const stream = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: maxTokens,
      reasoning_effort: 'minimal',
      verbosity: 'low',
      stream: true
    });

    let reply = '';
    let responseId = null;
    let responseModel = OPENAI_MODEL;
    let finishReason = null;

    for await (const chunk of stream) {
      responseId = responseId || chunk?.id || null;
      responseModel = chunk?.model || responseModel;
      finishReason = chunk?.choices?.[0]?.finish_reason || finishReason;

      const delta = chunk?.choices?.[0]?.delta?.content || '';
      if (!delta) continue;

      reply += delta;
      emittedAnyDelta = true;
      await emitDelta(delta);
    }

    const elapsedMs = Date.now() - startedAt;
    if (!reply.trim()) {
      console.warn(
        `[ai.service] OpenAI streamed empty reply in ${elapsedMs}ms ` +
          `(model=${responseModel}, id=${responseId || 'n/a'}, ` +
          `finish=${finishReason || 'n/a'}); serving offline fallback.`
      );
      const fallback = offlineFallback();
      await streamFallbackText(fallback.reply, emitDelta);
      return fallback;
    }

    console.log(
      `[ai.service] OpenAI stream ok (model=${responseModel}, ` +
        `id=${responseId || 'n/a'}, ${elapsedMs}ms, ${reply.length} chars)`
    );

    return {
      reply,
      raw: {
        id: responseId,
        model: responseModel
      }
    };
  } catch (error) {
    logAiProviderError(error);
    if (emittedAnyDelta) {
      throw error;
    }
    const fallback = offlineFallback();
    await streamFallbackText(fallback.reply, emitDelta);
    return fallback;
  }
};

export const fetchAiPrompt = async (language = 'en') => {
  const lang = normalizeLanguage(language);
  const config = await readPromptConfig(lang);

  return {
    language: lang,
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

export const fetchAllAiPrompts = async () => {
  const [en, it] = await Promise.all([fetchAiPrompt('en'), fetchAiPrompt('it')]);
  return { en, it };
};

export const updateAiPrompt = async ({
  language = 'en',
  welcomeMessage,
  systemInstruction,
  fallbackMessage
}) => {
  const lang = normalizeLanguage(language);
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
    { type: 'global_prompt', language: lang },
    {
      $set: update,
      $setOnInsert: { type: 'global_prompt', language: lang }
    },
    { upsert: true }
  );

  invalidatePromptConfigCache();

  return fetchAiPrompt(lang);
};
