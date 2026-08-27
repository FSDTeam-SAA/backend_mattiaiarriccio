import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Conversation from '../models/conversation.model.js';
import {
  requestAiReply,
  requestAiReplyStream,
  requestAiReplyWithSearch,
  getAiServiceInfo,
  DEFAULT_AI_EMERGENCY_TYPE
} from '../services/ai.service.js';
import {
  shouldConsiderWebSearch,
  checkWebSearchQuota,
  recordWebSearch
} from '../services/webSearch.service.js';
import {
  detectWeatherIntent,
  extractRequestedPlace,
  placeMatchesLocation,
  getWeatherSnapshot,
  formatWeatherContext
} from '../services/weather.service.js';
import { getSetting } from '../services/settings.service.js';
import User from '../models/user.model.js';
import { sendSuccess } from '../utils/response.js';
import { summarizeText } from '../services/security.service.js';
import { createId } from '../lib/id.js';
import {
  messageFor,
  resolveRequestLanguage
} from '../services/language.service.js';
import {
  buildPlaybookAiContext,
  routeEmergencyResponse,
  ROUTING_SOURCES
} from '../services/emergency.service.js';

const summarizeConversation = (conversation) => ({
  id: conversation._id,
  title: conversation.title,
  emergencyType: conversation.emergencyType || '',
  language: conversation.language || 'en',
  messageCount: conversation.messages.length,
  lastMessagePreview:
    conversation.messages[conversation.messages.length - 1]?.content || '',
  updatedAt: conversation.updatedAt,
  createdAt: conversation.createdAt
});

const serializeMessage = (message) => ({
  id: message._id,
  role: message.role,
  content: message.content,
  routingSource: message.routingSource || '',
  routingConfidence:
    typeof message.routingConfidence === 'number'
      ? message.routingConfidence
      : null,
  matchedPlaybookId: message.matchedPlaybookId || '',
  routingReason: message.routingReason || '',
  usedWebSearch: Boolean(message.usedWebSearch),
  sources: Array.isArray(message.sources)
    ? message.sources.map((source) => ({
        title: source.title || '',
        url: source.url || '',
        domain: source.domain || ''
      }))
    : [],
  weather: message.weather || null,
  createdAt: message.createdAt
});

const serializeConversation = (conversation) => ({
  id: conversation._id,
  title: conversation.title,
  userId: conversation.userId,
  emergencyType: conversation.emergencyType || '',
  language: conversation.language || 'en',
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  messages: conversation.messages.map(serializeMessage)
});

const normalizeEmergencyType = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const pickFirstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== '');

const parseBooleanFlag = (value) =>
  value === true || value === 1 || value === 'true' || value === '1';

const resolveEmergencyType = (requestedEmergencyType, conversation) =>
  requestedEmergencyType ||
  normalizeEmergencyType(conversation?.emergencyType) ||
  DEFAULT_AI_EMERGENCY_TYPE;

const buildEmergencyAwareMessage = (message, emergencyType, language) => {
  const trimmedMessage = String(message || '').trim();

  if (trimmedMessage) {
    return trimmedMessage;
  }

  if (!emergencyType) {
    return '';
  }

  if (language === 'it') {
    return `Aiutami con un'emergenza: ${emergencyType}. Inizia dalle azioni immediate piu importanti.`;
  }

  return `Help me with a ${emergencyType} emergency. Start with the most important immediate actions.`;
};

const buildAiQuery = ({
  conversation,
  latestMessage,
  emergencyType,
  isNewConversation
}) => {
  const history = conversation?.messages?.slice(-4) || [];
  const selectedEmergencyType = normalizeEmergencyType(
    emergencyType || conversation?.emergencyType
  );
  const emergencyContext = selectedEmergencyType
    ? [
        `Selected emergency type: ${selectedEmergencyType}.`,
        isNewConversation
          ? 'This is the first assistant response in the conversation. Do not start with a generic greeting. Start with situation-specific emergency guidance immediately.'
          : 'Keep the response aligned with this emergency type unless the user clearly changes topics.'
      ].join('\n')
    : '';

  if (history.length === 0) {
    return [emergencyContext, `Latest user request:\n${latestMessage}`]
      .filter(Boolean)
      .join('\n\n');
  }

  const formattedHistory = history
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n');

  return [
    emergencyContext,
    'Recent context:',
    formattedHistory,
    `Latest user request:\n${latestMessage}`
  ]
    .filter(Boolean)
    .join('\n\n');
};

const parseChatRequest = async (req) => {
  const requestedLanguage = resolveRequestLanguage(
    req,
    req.auth.user.preferredLanguage
  );
  const requestedEmergencyType = normalizeEmergencyType(
    pickFirstDefined(req.body.emergencyType, req.body.emergency_type)
  );
  const message = buildEmergencyAwareMessage(
    pickFirstDefined(req.body.message, req.body.query),
    requestedEmergencyType,
    requestedLanguage
  );
  const requestedConversationId = String(
    pickFirstDefined(req.body.conversationId, req.body.conversation_id) || ''
  ).trim();
  // Set only by the four dedicated Live Information actions. Typed messages
  // leave this false and continue through the dashboard-managed trigger gate.
  const forceWebSearch = parseBooleanFlag(
    pickFirstDefined(req.body.forceWebSearch, req.body.force_web_search)
  );

  if (!message) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'message is required unless emergencyType is provided'
    );
  }

  const conversation = requestedConversationId
    ? await Conversation.findOne({
        _id: requestedConversationId,
        userId: req.auth.user._id
      })
    : null;

  if (requestedConversationId && !conversation) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Conversation not found');
  }

  const effectiveEmergencyType = resolveEmergencyType(
    requestedEmergencyType,
    conversation
  );

  // Fall back to the last location the app reported, so "and tomorrow?" still
  // knows where "here" is without the client resending it every message.
  const location =
    parseLocationInput(req.body) ||
    (req.auth.user.lastLocation
      ? {
          city: req.auth.user.lastLocation.city || '',
          region: req.auth.user.lastLocation.region || '',
          country: req.auth.user.lastLocation.country || '',
          timezone: req.auth.user.lastLocation.timezone || ''
        }
      : null);

  return {
    requestedLanguage,
    requestedEmergencyType,
    requestedConversationId,
    message,
    conversation,
    effectiveEmergencyType,
    forceWebSearch,
    location,
    freshLocation: parseLocationInput(req.body),
    aiQuery: buildAiQuery({
      conversation: conversation?.toObject(),
      latestMessage: message,
      emergencyType: effectiveEmergencyType,
      isNewConversation: !conversation
    })
  };
};

const ensureConversationForMessage = ({
  conversation,
  requestedEmergencyType,
  effectiveEmergencyType,
  requestedLanguage,
  message,
  userId
}) => {
  if (!conversation) {
    return new Conversation({
      _id: createId('conv'),
      userId,
      title: summarizeText(
        requestedEmergencyType ? `${requestedEmergencyType} emergency` : message,
        42
      ),
      emergencyType: effectiveEmergencyType,
      language: requestedLanguage,
      messages: []
    });
  }

  if (
    requestedEmergencyType ||
    !normalizeEmergencyType(conversation.emergencyType)
  ) {
    conversation.emergencyType = effectiveEmergencyType;
  }
  conversation.language = requestedLanguage;
  return conversation;
};

const writeSseEvent = (res, event, data) => {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const setSseHeaders = (res) => {
  res.status(StatusCodes.OK);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
};

const userSafeStreamError = () =>
  'Unable to deliver this message right now. Please try again.';

const buildRoutedAiQuery = (chat, routingDecision) => {
  const playbookContext = buildPlaybookAiContext(routingDecision);
  return [playbookContext, chat.aiQuery].filter(Boolean).join('\n\n');
};

const routingMetadata = (routingDecision) =>
  routingDecision?.metadata || {
    routingSource: ROUTING_SOURCES.OPENAI,
    routingConfidence: 0,
    matchedPlaybookId: '',
    routingReason: 'OpenAI selected.'
  };

const buildAssistantMessage = ({
  content,
  routingDecision,
  usedWebSearch = false,
  sources = [],
  weather = null
}) => ({
  _id: createId('msg'),
  role: 'assistant',
  content,
  ...routingMetadata(routingDecision),
  usedWebSearch: Boolean(usedWebSearch),
  sources: Array.isArray(sources) ? sources : [],
  weather: weather || null,
  createdAt: new Date()
});

/**
 * Reads the coarse location the app may attach to a chat message. Accepts only
 * city/region/country/timezone - never coordinates, which the web_search tool
 * cannot use anyway.
 */
const parseLocationInput = (body) => {
  const raw = body?.location || body?.userLocation;
  if (!raw || typeof raw !== 'object') return null;

  const location = {
    city: String(raw.city || '').trim(),
    region: String(raw.region || raw.state || '').trim(),
    country: String(raw.country || raw.countryCode || '').trim(),
    timezone: String(raw.timezone || '').trim(),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    accuracyMeters: Number(raw.accuracyMeters ?? raw.accuracy)
  };

  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
    delete location.latitude;
  }
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    delete location.longitude;
  }
  if (!Number.isFinite(location.accuracyMeters) || location.accuracyMeters < 0) {
    delete location.accuracyMeters;
  }

  return location.city ||
    location.region ||
    location.country ||
    (location.latitude !== undefined && location.longitude !== undefined)
    ? location
    : null;
};

/**
 * Decides whether this message should be answered with live information.
 *
 * Order matters and is all cost control: the cheap checks (master switch,
 * keyword gate) run before anything that touches the database, so an ordinary
 * question like "what goes in a 72h kit?" costs one settings-cache read and
 * nothing else.
 *
 * Returns { search: false } to take the existing chat path unchanged, or
 * { search: true, quota } to take the live path. `limited` means the user
 * wanted live data but is out of allowance: they still get a normal answer,
 * and the app shows an upgrade note.
 */
const resolveWebSearchDecision = async ({
  message,
  language,
  user,
  forceWebSearch = false
}) => {
  const enabled = await getSetting('webSearchEnabled');
  if (!enabled) {
    return { search: false, limited: false, reason: 'webSearchEnabled=false' };
  }

  const wantsLiveInfo = await shouldConsiderWebSearch({
    text: message,
    language,
    force: forceWebSearch
  });
  if (!wantsLiveInfo) {
    return { search: false, limited: false, reason: 'no-trigger-keyword-matched' };
  }

  const quota = await checkWebSearchQuota(user);
  if (!quota.allowed) {
    return {
      search: false,
      limited: true,
      quota,
      reason: `daily-quota-exhausted (${quota.used}/${quota.limit})`
    };
  }

  return {
    search: true,
    limited: false,
    quota,
    reason: forceWebSearch
      ? 'dedicated-live-information-action'
      : 'live-trigger-matched'
  };
};

/**
 * A live request may also resemble an emergency playbook. Keep that approved
 * playbook in the AI context, but mark the delivered answer as an OpenAI/Web
 * Search answer instead of claiming the static template was returned.
 */
const routingDecisionForAnswer = (routingDecision, webSearchDecision) => {
  if (!webSearchDecision.search) return routingDecision;

  const reason = 'Live information request routed to approved-source Web Search.';
  return {
    ...routingDecision,
    source: ROUTING_SOURCES.OPENAI,
    reason,
    metadata: {
      routingSource: ROUTING_SOURCES.OPENAI,
      routingConfidence: routingDecision?.confidence || 0,
      matchedPlaybookId: routingDecision?.matchedPlaybookId || '',
      routingReason: reason
    }
  };
};

/**
 * One line per message recording which gate decided the live path.
 *
 * Every skip above is silent to the user by design, and the failure modes are
 * indistinguishable from the outside: an admin toggle, a keyword miss, an empty
 * approved-domain list and a spent quota all produce the same ordinary answer.
 * This is the only place that tells them apart in production logs.
 */
const logWebSearchDecision = ({ decision, message, language, hasLocation }) => {
  const preview = String(message || '').slice(0, 60).replace(/\s+/g, ' ');
  console.log(
    `[webSearch] ${decision.search ? 'SEARCH' : 'SKIP'} ` +
      `reason=${decision.reason || 'unknown'} lang=${language} ` +
      `location=${hasLocation ? 'yes' : 'none'} ` +
      `quota=${
        decision.quota
          ? `${decision.quota.used}/${
              decision.quota.unlimited ? '∞' : decision.quota.limit
            }${decision.quota.premium ? ' premium' : ' free'}`
          : 'n/a'
      } msg="${preview}"`
  );
};

/**
 * Persists the caller's latest coarse location so follow-up questions keep
 * their area without the app resending it. Best-effort: never blocks a reply.
 */
const rememberLocation = async (userId, location) => {
  if (!userId || !location) return;
  try {
    // Exact coordinates are used only for this request's weather lookup. Keep
    // only the coarse place for follow-up search bias and data minimisation.
    const coarseLocation = {
      city: location.city || '',
      region: location.region || '',
      country: location.country || '',
      timezone: location.timezone || ''
    };
    await User.updateOne(
      { _id: userId },
      { $set: { lastLocation: { ...coarseLocation, updatedAt: new Date() } } }
    );
  } catch (error) {
    console.error(
      '[chat.controller] failed to store user location:',
      error?.message || error
    );
  }
};

/**
 * Resolves measured weather for this message, if it is asking for any.
 *
 * Deliberately independent of resolveWebSearchDecision. The approved-domain
 * search answers "is there an alert" well and "what is the temperature" not at
 * all, because those sites publish maps and PDFs rather than readable figures -
 * which is why weather questions used to come back as "go and check the
 * Bollettino yourself", and as a flat refusal for anyone outside Italy. Numbers
 * now come from the weather provider; the approved sources keep the alerts.
 *
 * It is also NOT charged against the live-search quota: the provider is free,
 * so a user out of allowance still gets real conditions.
 *
 * Returns `needsLocation` when the question needs a place and we have none.
 * That case is a UI affordance in the app, not a paragraph of apology.
 */
const resolveWeather = async ({ message, language, location }) => {
  if (!detectWeatherIntent(message)) {
    return { snapshot: null, needsLocation: false, asked: false };
  }

  // A place named in the question outranks the device's own: "weather in
  // Italy" asked from Dhaka must not be answered with Dhaka's conditions.
  // If it does not geocode it was not a place, and the device location below
  // still answers the question.
  const requestedPlace = extractRequestedPlace(message);
  if (requestedPlace && !placeMatchesLocation(requestedPlace, location)) {
    const snapshot = await getWeatherSnapshot({
      location: { city: requestedPlace },
      language
    });
    if (snapshot) {
      return { snapshot, needsLocation: false, asked: true, requestedPlace };
    }
  }

  if (!location) {
    // Asking for a location the user did not want to talk about would be a
    // non-sequitur, so the prompt is only offered when the question was about
    // where they are.
    return {
      snapshot: null,
      needsLocation: !requestedPlace,
      asked: true,
      requestedPlace
    };
  }

  const snapshot = await getWeatherSnapshot({ location, language });
  return { snapshot, needsLocation: false, asked: true, requestedPlace };
};

/**
 * What the model is told when a weather question arrives without a location.
 *
 * Without this the model writes several paragraphs explaining which national
 * weather service to visit - the second screenshot in the bug report. The app
 * shows a one-tap "use my location" action instead, so the text only has to be
 * one honest line.
 */
const locationPromptContext = (language) =>
  language === 'it'
    ? 'CONTESTO METEO: l\'utente chiede le condizioni attuali ma la sua posizione non e ' +
      'disponibile. L\'app mostra gia un pulsante per condividere la posizione. ' +
      'Rispondi con UNA sola riga breve che dice che ti serve la posizione, poi fermati. ' +
      'Non elencare siti meteo, non dare istruzioni passo passo, non scusarti a lungo.'
    : 'WEATHER CONTEXT: the user is asking for current conditions but their location is ' +
      'not available. The app already shows a one-tap button to share it. Reply with ONE ' +
      'short line saying you need their location, then stop. Do not list weather websites, ' +
      'do not give step-by-step instructions, do not write a long apology.';

/** The system-prompt block for this turn: real figures, or the ask for a place. */
const buildWeatherContext = (weather, language) => {
  if (weather.snapshot) return formatWeatherContext(weather.snapshot, language);
  if (weather.needsLocation) return locationPromptContext(language);
  return '';
};

/** One line per weather-intent message, so a missing card is diagnosable. */
const logWeatherDecision = ({ weather, location }) => {
  if (!weather.asked) return;
  console.log(
    `[weather] ${weather.snapshot ? 'DATA' : weather.needsLocation ? 'NO-LOCATION' : 'LOOKUP-FAILED'} ` +
      `place="${weather.requestedPlace || location?.city || location?.region || location?.country || 'n/a'}" ` +
      `${weather.requestedPlace ? 'from=message ' : ''}` +
      `flags=${weather.snapshot?.safetyFlags?.join(',') || 'none'}`
  );
};

export const listConversations = catchAsync(async (req, res) => {
  const conversations = await Conversation.find({ userId: req.auth.user._id })
    .sort({ updatedAt: -1 })
    .lean();

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'chatHistoryFetched'),
    data: conversations.map(summarizeConversation)
  });
});

export const getConversationById = catchAsync(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    userId: req.auth.user._id
  }).lean();

  if (!conversation) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Conversation not found');
  }

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'conversationFetched'),
    data: {
      ...serializeConversation(conversation),
      aiSource: getAiServiceInfo()
    }
  });
});

export const sendChatMessage = catchAsync(async (req, res) => {
  const chat = await parseChatRequest(req);

  const routingDecision = await routeEmergencyResponse({
    text: chat.message,
    language: chat.requestedLanguage,
    emergencyType: chat.effectiveEmergencyType,
    conversation: chat.conversation?.toObject()
  });

  const webSearchDecision = await resolveWebSearchDecision({
    message: chat.message,
    language: chat.requestedLanguage,
    user: req.auth.user,
    forceWebSearch: chat.forceWebSearch
  });
  const answerRoutingDecision = routingDecisionForAnswer(
    routingDecision,
    webSearchDecision
  );
  logWebSearchDecision({
    decision: webSearchDecision,
    message: chat.message,
    language: chat.requestedLanguage,
    hasLocation: Boolean(chat.location)
  });

  await rememberLocation(req.auth.user._id, chat.freshLocation);

  // Resolved before any AI call so the model answers with the figures in hand
  // rather than hedging about not being able to reach them.
  const weather = await resolveWeather({
    message: chat.message,
    language: chat.requestedLanguage,
    location: chat.location
  });
  logWeatherDecision({ weather, location: chat.location });
  const weatherContext = buildWeatherContext(weather, chat.requestedLanguage);

  let aiResponse;
  if (webSearchDecision.search) {
    try {
      aiResponse = await requestAiReplyWithSearch({
        emergencyType: chat.effectiveEmergencyType,
        language: chat.requestedLanguage,
        query: buildRoutedAiQuery(chat, routingDecision),
        caller: req.auth.user,
        location: chat.location,
        weatherContext
      });

      if (aiResponse.usedWebSearch) {
        await recordWebSearch({
          userId: req.auth.user._id,
          premium: webSearchDecision.quota?.premium
        });
      }
    } catch (error) {
      // Live data failed; never let that cost the user an answer.
      console.error(
        '[chat.controller] web search path failed, falling back to standard reply:',
        error?.message || error
      );
      aiResponse = null;
    }
  } else if (routingDecision.source === ROUTING_SOURCES.STORED) {
    aiResponse = {
      reply: routingDecision.matchedPlaybook.responseTemplate,
      emergency: true
    };
  }

  if (!aiResponse) {
    aiResponse = await requestAiReply({
      emergencyType: chat.effectiveEmergencyType,
      language: chat.requestedLanguage,
      query: buildRoutedAiQuery(chat, routingDecision),
      caller: req.auth.user,
      fallbackReply: routingDecision.matchedPlaybook?.responseTemplate || '',
      weatherContext
    });
  }

  const conversation = ensureConversationForMessage({
    conversation: chat.conversation,
    requestedEmergencyType: chat.requestedEmergencyType,
    effectiveEmergencyType: chat.effectiveEmergencyType,
    requestedLanguage: chat.requestedLanguage,
    message: chat.message,
    userId: req.auth.user._id
  });

  const userMessage = {
    _id: createId('msg'),
    role: 'user',
    content: chat.message,
    createdAt: new Date()
  };

  const assistantMessage = buildAssistantMessage({
    content: aiResponse.reply,
    routingDecision: answerRoutingDecision,
    usedWebSearch: aiResponse.usedWebSearch,
    sources: aiResponse.sources,
    weather: weather.snapshot
  });

  conversation.messages.push(userMessage, assistantMessage);
  await conversation.save();

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: messageFor(chat.requestedLanguage, 'chatProcessed'),
    data: {
      conversation: serializeConversation(conversation.toObject()),
      userMessage: serializeMessage(userMessage),
      assistantMessage: serializeMessage(assistantMessage),
      aiSource: getAiServiceInfo(),
      degraded: Boolean(aiResponse?.degraded),
      emergencyOverride:
        routingDecision.source === ROUTING_SOURCES.STORED &&
        !webSearchDecision.search,
      usedWebSearch: Boolean(aiResponse?.usedWebSearch),
      sources: aiResponse?.sources || [],
      // What the model actually searched for. Not persisted on the message -
      // this is transparency for the answer being delivered right now.
      searchQueries: aiResponse?.searchQueries || [],
      // Measured conditions for the app's weather card. Null when the message
      // was not about weather, or when the lookup could not run.
      weather: weather.snapshot,
      // The question needed a place and we had none: the app offers a one-tap
      // location share instead of making the user read an apology.
      weatherNeedsLocation: weather.needsLocation,
      // The user asked for live data but has none left today. They still get a
      // full answer; the app shows an upgrade note alongside it.
      liveInfoLimited: Boolean(webSearchDecision.limited),
      liveInfoLimit: webSearchDecision.quota?.limit ?? null,
      ...routingMetadata(routingDecision)
    }
  });
});

export const sendChatMessageStream = async (req, res, next) => {
  let requestedLanguage = 'en';

  try {
    const chat = await parseChatRequest(req);
    requestedLanguage = chat.requestedLanguage;

    const conversation = ensureConversationForMessage({
      conversation: chat.conversation,
      requestedEmergencyType: chat.requestedEmergencyType,
      effectiveEmergencyType: chat.effectiveEmergencyType,
      requestedLanguage: chat.requestedLanguage,
      message: chat.message,
      userId: req.auth.user._id
    });

    const userMessage = {
      _id: createId('msg'),
      role: 'user',
      content: chat.message,
      createdAt: new Date()
    };

    const routingDecision = await routeEmergencyResponse({
      text: chat.message,
      language: chat.requestedLanguage,
      emergencyType: chat.effectiveEmergencyType,
      conversation: chat.conversation?.toObject()
    });
    const webSearchDecision = await resolveWebSearchDecision({
      message: chat.message,
      language: chat.requestedLanguage,
      user: req.auth.user,
      forceWebSearch: chat.forceWebSearch
    });
    const answerRoutingDecision = routingDecisionForAnswer(
      routingDecision,
      webSearchDecision
    );
    const routeMeta = routingMetadata(answerRoutingDecision);
    logWebSearchDecision({
      decision: webSearchDecision,
      message: chat.message,
      language: chat.requestedLanguage,
      hasLocation: Boolean(chat.location)
    });

    await rememberLocation(req.auth.user._id, chat.freshLocation);

    const weather = await resolveWeather({
      message: chat.message,
      language: chat.requestedLanguage,
      location: chat.location
    });
    logWeatherDecision({ weather, location: chat.location });
    const weatherContext = buildWeatherContext(weather, chat.requestedLanguage);

    setSseHeaders(res);
    writeSseEvent(res, 'meta', {
      conversationId: conversation._id,
      emergencyType: conversation.emergencyType || '',
      language: conversation.language || 'en',
      userMessage: serializeMessage(userMessage),
      aiSource: getAiServiceInfo(),
      emergencyOverride:
        routingDecision.source === ROUTING_SOURCES.STORED &&
        !webSearchDecision.search,
      liveInfoLimited: Boolean(webSearchDecision.limited),
      liveInfoLimit: webSearchDecision.quota?.limit ?? null,
      ...routeMeta
    });

    // Sent on `meta`, i.e. before the first token: the card is the answer to a
    // weather question, so it should be on screen while the safety note is
    // still being written rather than appearing after it.
    if (weather.snapshot || weather.needsLocation) {
      writeSseEvent(res, 'weather', {
        weather: weather.snapshot,
        weatherNeedsLocation: weather.needsLocation
      });
    }

    let aiResponse = null;
    if (webSearchDecision.search) {
      let emittedAnyDelta = false;
      try {
        aiResponse = await requestAiReplyWithSearch({
          emergencyType: chat.effectiveEmergencyType,
          language: chat.requestedLanguage,
          query: buildRoutedAiQuery(chat, routingDecision),
          caller: req.auth.user,
          location: chat.location,
          weatherContext,
          onStatus: async (state, detail = {}) => {
            // Drives the live-search indicator in the app. `queries` is what
            // the model actually searched for, shown so the user can see the
            // lookup happening rather than staring at an unexplained spinner.
            writeSseEvent(res, 'status', { state, ...detail });
          },
          onDelta: async (delta) => {
            emittedAnyDelta = true;
            writeSseEvent(res, 'delta', { text: delta });
          }
        });

        if (aiResponse.usedWebSearch) {
          await recordWebSearch({
            userId: req.auth.user._id,
            premium: webSearchDecision.quota?.premium
          });
        }
      } catch (error) {
        console.error(
          `[chat.controller] streaming web search failed (code=${
            error?.code || 'n/a'
          }), falling back to the ordinary chat path:`,
          error?.message || error
        );
        // Only safe to retry on the ordinary path if the client has not already
        // started rendering search output; otherwise the answer would duplicate.
        if (emittedAnyDelta) throw error;
        // 'unavailable' rather than 'idle': the user asked for live data and is
        // about to get an answer without it, and silently swapping the spinner
        // back is what made this failure invisible in the first place.
        writeSseEvent(res, 'status', { state: 'unavailable' });
        aiResponse = null;
      }
    } else if (routingDecision.source === ROUTING_SOURCES.STORED) {
      aiResponse = {
        reply: routingDecision.matchedPlaybook.responseTemplate,
        emergency: true
      };
      writeSseEvent(res, 'delta', {
        text: routingDecision.matchedPlaybook.responseTemplate
      });
    }

    if (!aiResponse) {
      aiResponse = await requestAiReplyStream({
        emergencyType: chat.effectiveEmergencyType,
        language: chat.requestedLanguage,
        query: buildRoutedAiQuery(chat, routingDecision),
        caller: req.auth.user,
        fallbackReply: routingDecision.matchedPlaybook?.responseTemplate || '',
        weatherContext,
        onDelta: async (delta) => {
          writeSseEvent(res, 'delta', { text: delta });
        }
      });
    }

    const assistantMessage = buildAssistantMessage({
      content: aiResponse.reply,
      routingDecision: answerRoutingDecision,
      usedWebSearch: aiResponse.usedWebSearch,
      sources: aiResponse.sources,
      weather: weather.snapshot
    });

    conversation.messages.push(userMessage, assistantMessage);
    await conversation.save();

    writeSseEvent(res, 'done', {
      success: true,
      message: messageFor(chat.requestedLanguage, 'chatProcessed'),
      conversation: serializeConversation(conversation.toObject()),
      userMessage: serializeMessage(userMessage),
      assistantMessage: serializeMessage(assistantMessage),
      aiSource: getAiServiceInfo(),
      degraded: Boolean(aiResponse?.degraded),
      emergencyOverride:
        routingDecision.source === ROUTING_SOURCES.STORED &&
        !webSearchDecision.search,
      usedWebSearch: Boolean(aiResponse?.usedWebSearch),
      sources: aiResponse?.sources || [],
      // What the model actually searched for. Not persisted on the message -
      // this is transparency for the answer being delivered right now.
      searchQueries: aiResponse?.searchQueries || [],
      weather: weather.snapshot,
      weatherNeedsLocation: weather.needsLocation,
      liveInfoLimited: Boolean(webSearchDecision.limited),
      liveInfoLimit: webSearchDecision.quota?.limit ?? null,
      ...routeMeta
    });
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      next(error);
      return;
    }

    console.error('[chat.controller] streaming chat failed:', error);
    writeSseEvent(res, 'error', {
      success: false,
      message: userSafeStreamError(),
      localizedMessage: messageFor(requestedLanguage, 'chatProcessed')
    });
    res.end();
  }
};

export const deleteConversation = catchAsync(async (req, res) => {
  const deletedConversation = await Conversation.findOneAndDelete({
    _id: req.params.conversationId,
    userId: req.auth.user._id
  });

  if (!deletedConversation) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Conversation not found');
  }

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'conversationDeleted')
  });
});
