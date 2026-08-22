import OpenAI from 'openai';
import PromptConfig from '../models/promptConfig.model.js';
import { getSetting } from './settings.service.js';
import { isPremiumUser } from './premium.service.js';
import {
  getAllowedDomains,
  extractSources,
  responseUsedWebSearch,
  buildUserLocation
} from './webSearch.service.js';
import {
  defaultWelcomeFor,
  defaultSystemInstructionFor,
  defaultFallbackFor,
  defaultSuggestedQuestionsFor,
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

/**
 * Floor for max_output_tokens on the live-information path only.
 *
 * On the Responses API reasoning tokens are billed against max_output_tokens
 * alongside the visible answer. A web_search turn at reasoning effort 'low'
 * routinely spends several hundred tokens before emitting a single visible
 * character, so the free tier's 600-token budget can be consumed entirely by
 * reasoning: the response comes back `incomplete`, the reply is empty, this
 * module throws, and the caller silently falls back to the ordinary chat path -
 * which is exactly the "I can't access real-time information" answer users see.
 *
 * The tier caps above still apply unchanged to the ordinary chat path, where
 * reasoning effort is 'minimal' and the budget is all answer.
 */
const WEB_SEARCH_MIN_OUTPUT_TOKENS = 2000;

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
      (doc && doc.fallback_message) || defaultFallbackFor(lang),
    suggestedQuestions:
      Array.isArray(doc?.suggested_questions) && doc.suggested_questions.length > 0
        ? doc.suggested_questions.map((item) => String(item)).filter(Boolean)
        : defaultSuggestedQuestionsFor(lang)
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

const buildAiRequest = async ({
  query,
  emergencyType,
  language,
  caller,
  fallbackReply = '',
  weatherContext = ''
}) => {
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

  // Measured conditions, when we have them, ride along on the ordinary chat
  // path too. Weather comes from a free provider and is deliberately NOT gated
  // by the web-search quota, so a user who is out of live-search allowance
  // still gets real numbers instead of "I cannot access current weather".
  const messages = [
    {
      role: 'system',
      content: weatherContext
        ? `${systemMessage}\n\n${weatherContext}`
        : systemMessage
    },
    { role: 'user', content: String(query || '') }
  ];

  const offlineFallback = () => {
    const approvedFallback = String(fallbackReply || '').trim();
    if (approvedFallback) {
      return {
        reply: approvedFallback,
        raw: {
          id: null,
          model: 'stored-emergency-playbook'
        },
        degraded: true,
        fallbackSource: 'stored'
      };
    }

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
  caller = null,
  fallbackReply = '',
  weatherContext = ''
}) => {
  const { messages, offlineFallback, maxTokens } = await buildAiRequest({
    query,
    emergencyType,
    language,
    caller,
    fallbackReply,
    weatherContext
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
  caller = null,
  fallbackReply = '',
  weatherContext = ''
}) => {
  const { messages, offlineFallback, maxTokens } = await buildAiRequest({
    query,
    emergencyType,
    language,
    caller,
    fallbackReply,
    weatherContext
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

/* ------------------------------------------------------------------ *
 * Live-information path (OpenAI native Web Search)
 *
 * Separate from the two functions above because the web_search tool only
 * exists on the Responses API - Chat Completions cannot call it. Everything
 * else (prompt resolution, tier caps, offline fallback) is shared.
 * ------------------------------------------------------------------ */

/**
 * Builds the system prompt for a live-information answer.
 *
 * The tier prompt and the Web Search prompt are CONCATENATED, not swapped:
 * the tier prompt defines who WeSafe AI is, the Web Search prompt defines what
 * it does with live results. Sending both is what stops the assistant from
 * merely relaying what it found online.
 */
const buildWebSearchSystemMessage = async ({
  language,
  caller,
  emergencyType,
  weatherContext = ''
}) => {
  const lang = normalizeLanguage(language);
  const [config, promptConfig, webSearchPromptSetting] = await Promise.all([
    readPromptConfig(lang),
    resolvePromptConfig(caller),
    getSetting('webSearchPrompt')
  ]);

  const baseInstruction = promptConfig.systemPrompt || config.systemInstruction;
  const webSearchInstruction =
    (webSearchPromptSetting && webSearchPromptSetting[lang]) ||
    (webSearchPromptSetting && webSearchPromptSetting.en) ||
    '';

  const systemMessage = [
    baseInstruction,
    '',
    'LIVE INFORMATION MODE:',
    webSearchInstruction,
    // Measured conditions arrive from the weather provider, not from the
    // search. Placed after the search instruction so its "do not restate the
    // figures" rule is the last word on how to present them.
    ...(weatherContext ? ['', weatherContext] : []),
    '',
    'SELECTED LANGUAGE:',
    languageInstructionFor(lang),
    '',
    `SELECTED EMERGENCY TYPE: ${normalizeEmergencyType(emergencyType)}`
  ].join('\n');

  return { systemMessage, maxTokens: promptConfig.maxTokens };
};

/**
 * Turns a terminal Responses object into one diagnosable log line.
 *
 * An empty live answer has several very different causes - the budget ran out
 * during reasoning, the model refused, the upstream call failed - and they are
 * only distinguishable from `status`, `incomplete_details.reason` and the token
 * usage split. Without them the failure is indistinguishable from "OpenAI was
 * slow", which is what made this path so hard to diagnose in production.
 */
const describeTerminalResponse = (response) => {
  if (!response) {
    return 'no terminal response event arrived (stream ended early or the connection dropped)';
  }

  const parts = [`status=${response.status || 'unknown'}`];

  const reason = response.incomplete_details?.reason;
  if (reason) parts.push(`incompleteReason=${reason}`);

  const errorText = [response.error?.code, response.error?.message]
    .filter(Boolean)
    .join(': ');
  if (errorText) parts.push(`error="${errorText}"`);

  const usage = response.usage;
  if (usage) {
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens;
    parts.push(
      `outputTokens=${usage.output_tokens ?? 'n/a'}` +
        (reasoningTokens === undefined
          ? ''
          : ` (reasoning=${reasoningTokens})`)
    );
  }

  return parts.join(' ');
};

/**
 * Streams an answer that may consult approved live sources.
 *
 * The tool is offered with tool_choice:'auto', so the model can still decide a
 * search is unnecessary - in which case no search is billed and `usedWebSearch`
 * comes back false.
 *
 * Callers must treat a thrown error as "fall back to the ordinary chat path".
 * A live-data failure should never cost the user an answer they would otherwise
 * have received.
 *
 * @returns {Promise<{reply, sources, usedWebSearch, raw}>}
 */
export const requestAiReplyWithSearch = async ({
  query,
  emergencyType,
  language,
  caller = null,
  location = null,
  weatherContext = '',
  onDelta,
  onStatus
}) => {
  const allowedDomains = await getAllowedDomains();

  // No approved sources means no search we are allowed to run. Searching the
  // open web instead would violate the agreed behaviour, so refuse the path.
  if (allowedDomains.length === 0) {
    const error = new Error('No active approved domains are configured');
    error.code = 'NO_APPROVED_DOMAINS';
    throw error;
  }

  const { systemMessage, maxTokens } = await buildWebSearchSystemMessage({
    language,
    caller,
    emergencyType,
    weatherContext
  });

  const emitDelta = typeof onDelta === 'function' ? onDelta : async () => {};
  const emitStatus = typeof onStatus === 'function' ? onStatus : async () => {};

  const contextSize = await getSetting('webSearchContextSize');
  const userLocation = buildUserLocation(location);

  const tool = {
    type: 'web_search',
    filters: { allowed_domains: allowedDomains },
    search_context_size: contextSize
  };
  if (userLocation) {
    tool.user_location = userLocation;
  }

  const client = getOpenAIClient();
  const startedAt = Date.now();

  // See WEB_SEARCH_MIN_OUTPUT_TOKENS: this budget covers reasoning tokens too,
  // so the tier cap alone is not enough to get a visible answer out.
  const outputTokenBudget = Math.max(maxTokens, WEB_SEARCH_MIN_OUTPUT_TOKENS);

  const stream = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: String(query || '') }
    ],
    tools: [tool],
    // 'required' rather than 'auto'. By the time we get here the keyword gate
    // and the quota check have both already decided this question needs live
    // data, and left to itself gpt-5-mini is unreliable about acting on that:
    // observed failures were asking the user for permission to check, and
    // claiming it "cannot access real-time information" while holding the tool.
    // We supply exactly one tool, so 'required' forces that web search.
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    max_output_tokens: outputTokenBudget,
    // 'minimal' is what the ordinary chat path uses, but OpenAI rejects it
    // alongside web_search ("tools cannot be used with reasoning.effort
    // 'minimal'"), so the live path steps up to 'low' - the cheapest effort the
    // tool actually supports.
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
    stream: true
  });

  let reply = '';
  let finalResponse = null;
  let announcedSearching = false;

  // What the model actually typed into the search box. Shown in the app so the
  // user can see the search happening rather than just waiting on a spinner.
  const searchQueries = [];
  const collectQueries = (item) => {
    const action = item?.action;
    if (!action) return false;

    const found = Array.isArray(action.queries)
      ? action.queries
      : action.query
        ? [action.query]
        : [];

    let added = false;
    for (const raw of found) {
      const text = String(raw || '').trim();
      if (text && !searchQueries.includes(text)) {
        searchQueries.push(text);
        added = true;
      }
    }
    return added;
  };

  for await (const event of stream) {
    switch (event?.type) {
      // Both fire around a real search; announce only once so the app shows a
      // single "Checking live information..." state.
      case 'response.web_search_call.in_progress':
      case 'response.web_search_call.searching': {
        if (!announcedSearching) {
          announcedSearching = true;
          await emitStatus('searching', { domains: allowedDomains.length });
        }
        break;
      }
      case 'response.web_search_call.completed': {
        await emitStatus('searchComplete', {
          queries: [...searchQueries],
          domains: allowedDomains.length
        });
        break;
      }
      // The completed item carries the queries and the consulted sources, which
      // the `.completed` event above does not. It arrives just after it, so this
      // re-emits the same state with the detail filled in; the app merges rather
      // than replaces, which makes the double emit harmless.
      case 'response.output_item.done': {
        if (event.item?.type !== 'web_search_call') break;
        if (collectQueries(event.item)) {
          await emitStatus('searchComplete', {
            queries: [...searchQueries],
            domains: allowedDomains.length
          });
        }
        break;
      }
      case 'response.output_text.delta': {
        const delta = event.delta || '';
        if (delta) {
          reply += delta;
          await emitDelta(delta);
        }
        break;
      }
      case 'response.completed': {
        finalResponse = event.response;
        break;
      }
      case 'response.failed':
      case 'response.incomplete': {
        finalResponse = event.response;
        break;
      }
      default:
        break;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const usedWebSearch = responseUsedWebSearch(finalResponse);
  const sources = usedWebSearch ? extractSources(finalResponse) : [];
  const incompleteReason = finalResponse?.incomplete_details?.reason || '';

  if (!reply.trim()) {
    const diagnosis = describeTerminalResponse(finalResponse);

    // Without this line the only trace of a failed live answer is the caller's
    // generic "falling back to standard reply", which says nothing about why.
    console.error(
      `[ai.service] web search produced no text in ${elapsedMs}ms; the caller will ` +
        `fall back to the ordinary chat path.\n` +
        `  ${diagnosis}\n` +
        `  model:   ${finalResponse?.model || OPENAI_MODEL}\n` +
        `  budget:  ${outputTokenBudget} max_output_tokens\n` +
        `  searched:${usedWebSearch} domains=${allowedDomains.length}` +
        (incompleteReason === 'max_output_tokens'
          ? '\n  hint:    the whole budget went to reasoning before any visible text. ' +
            'Raise WEB_SEARCH_MIN_OUTPUT_TOKENS in this file.'
          : '')
    );

    const error = new Error(
      `OpenAI web search returned an empty reply (${diagnosis})`
    );
    error.code = 'WEB_SEARCH_EMPTY_REPLY';
    throw error;
  }

  // tool_choice is 'required', so this should be unreachable. If it ever fires,
  // the model answered from memory and the answer is not actually live data.
  if (!usedWebSearch) {
    console.warn(
      `[ai.service] web search path answered WITHOUT searching despite ` +
        `tool_choice:'required' (model=${finalResponse?.model || OPENAI_MODEL}, ` +
        `id=${finalResponse?.id || 'n/a'}). The answer is not live data.`
    );
  }

  if (incompleteReason) {
    console.warn(
      `[ai.service] web search reply was truncated (reason=${incompleteReason}, ` +
        `budget=${outputTokenBudget}). Consider raising the output budget.`
    );
  }

  console.log(
    `[ai.service] web search reply ok (model=${finalResponse?.model || OPENAI_MODEL}, ` +
      `id=${finalResponse?.id || 'n/a'}, ${elapsedMs}ms, ${reply.length} chars, ` +
      `searched=${usedWebSearch}, queries=${searchQueries.length}, ` +
      `sources=${sources.length}, domains=${allowedDomains.length})`
  );

  return {
    reply,
    sources,
    usedWebSearch,
    searchQueries: [...searchQueries],
    raw: {
      id: finalResponse?.id || null,
      model: finalResponse?.model || OPENAI_MODEL
    }
  };
};

export const fetchAiPrompt = async (language = 'en') => {
  const lang = normalizeLanguage(language);
  const config = await readPromptConfig(lang);

  return {
    language: lang,
    welcomeMessage: config.welcomeInstruction,
    systemInstruction: config.systemInstruction,
    fallbackMessage: config.fallbackMessage,
    suggestedQuestions: config.suggestedQuestions,
    raw: {
      welcome_instruction: config.welcomeInstruction,
      system_instruction: config.systemInstruction,
      fallback_message: config.fallbackMessage,
      suggested_questions: config.suggestedQuestions
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
  fallbackMessage,
  suggestedQuestions
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
  if (suggestedQuestions !== undefined) {
    update.suggested_questions = Array.isArray(suggestedQuestions)
      ? suggestedQuestions.map((item) => String(item).trim()).filter(Boolean)
      : [];
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
