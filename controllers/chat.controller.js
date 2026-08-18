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
  sources = []
}) => ({
  _id: createId('msg'),
  role: 'assistant',
  content,
  ...routingMetadata(routingDecision),
  usedWebSearch: Boolean(usedWebSearch),
  sources: Array.isArray(sources) ? sources : [],
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
    timezone: String(raw.timezone || '').trim()
  };

  return location.city || location.region || location.country ? location : null;
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
const resolveWebSearchDecision = async ({ message, language, user, routingDecision }) => {
  // A stored playbook is an approved, deterministic answer - never override it.
  if (routingDecision?.source === ROUTING_SOURCES.STORED) {
    return { search: false, limited: false };
  }

  const enabled = await getSetting('webSearchEnabled');
  if (!enabled) return { search: false, limited: false };

  const wantsLiveInfo = await shouldConsiderWebSearch({ text: message, language });
  if (!wantsLiveInfo) return { search: false, limited: false };

  const quota = await checkWebSearchQuota(user);
  if (!quota.allowed) {
    return { search: false, limited: true, quota };
  }

  return { search: true, limited: false, quota };
};

/**
 * Persists the caller's latest coarse location so follow-up questions keep
 * their area without the app resending it. Best-effort: never blocks a reply.
 */
const rememberLocation = async (userId, location) => {
  if (!userId || !location) return;
  try {
    await User.updateOne(
      { _id: userId },
      { $set: { lastLocation: { ...location, updatedAt: new Date() } } }
    );
  } catch (error) {
    console.error(
      '[chat.controller] failed to store user location:',
      error?.message || error
    );
  }
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
    routingDecision
  });

  await rememberLocation(req.auth.user._id, chat.freshLocation);

  let aiResponse;
  if (routingDecision.source === ROUTING_SOURCES.STORED) {
    aiResponse = {
      reply: routingDecision.matchedPlaybook.responseTemplate,
      emergency: true
    };
  } else if (webSearchDecision.search) {
    try {
      aiResponse = await requestAiReplyWithSearch({
        emergencyType: chat.effectiveEmergencyType,
        language: chat.requestedLanguage,
        query: buildRoutedAiQuery(chat, routingDecision),
        caller: req.auth.user,
        location: chat.location
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
  }

  if (!aiResponse) {
    aiResponse = await requestAiReply({
      emergencyType: chat.effectiveEmergencyType,
      language: chat.requestedLanguage,
      query: buildRoutedAiQuery(chat, routingDecision),
      caller: req.auth.user,
      fallbackReply: routingDecision.matchedPlaybook?.responseTemplate || ''
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
    routingDecision,
    usedWebSearch: aiResponse.usedWebSearch,
    sources: aiResponse.sources
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
      emergencyOverride: routingDecision.source === ROUTING_SOURCES.STORED,
      usedWebSearch: Boolean(aiResponse?.usedWebSearch),
      sources: aiResponse?.sources || [],
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
    const routeMeta = routingMetadata(routingDecision);

    const webSearchDecision = await resolveWebSearchDecision({
      message: chat.message,
      language: chat.requestedLanguage,
      user: req.auth.user,
      routingDecision
    });

    await rememberLocation(req.auth.user._id, chat.freshLocation);

    setSseHeaders(res);
    writeSseEvent(res, 'meta', {
      conversationId: conversation._id,
      emergencyType: conversation.emergencyType || '',
      language: conversation.language || 'en',
      userMessage: serializeMessage(userMessage),
      aiSource: getAiServiceInfo(),
      emergencyOverride: routingDecision.source === ROUTING_SOURCES.STORED,
      liveInfoLimited: Boolean(webSearchDecision.limited),
      liveInfoLimit: webSearchDecision.quota?.limit ?? null,
      ...routeMeta
    });

    let aiResponse = null;
    if (routingDecision.source === ROUTING_SOURCES.STORED) {
      aiResponse = {
        reply: routingDecision.matchedPlaybook.responseTemplate,
        emergency: true
      };
      writeSseEvent(res, 'delta', {
        text: routingDecision.matchedPlaybook.responseTemplate
      });
    } else if (webSearchDecision.search) {
      let emittedAnyDelta = false;
      try {
        aiResponse = await requestAiReplyWithSearch({
          emergencyType: chat.effectiveEmergencyType,
          language: chat.requestedLanguage,
          query: buildRoutedAiQuery(chat, routingDecision),
          caller: req.auth.user,
          location: chat.location,
          onStatus: async (state) => {
            // Drives the "Checking live information..." indicator in the app.
            writeSseEvent(res, 'status', { state });
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
          '[chat.controller] streaming web search failed, falling back:',
          error?.message || error
        );
        // Only safe to retry on the ordinary path if the client has not already
        // started rendering search output; otherwise the answer would duplicate.
        if (emittedAnyDelta) throw error;
        writeSseEvent(res, 'status', { state: 'idle' });
        aiResponse = null;
      }
    }

    if (!aiResponse) {
      aiResponse = await requestAiReplyStream({
        emergencyType: chat.effectiveEmergencyType,
        language: chat.requestedLanguage,
        query: buildRoutedAiQuery(chat, routingDecision),
        caller: req.auth.user,
        fallbackReply: routingDecision.matchedPlaybook?.responseTemplate || '',
        onDelta: async (delta) => {
          writeSseEvent(res, 'delta', { text: delta });
        }
      });
    }

    const assistantMessage = buildAssistantMessage({
      content: aiResponse.reply,
      routingDecision,
      usedWebSearch: aiResponse.usedWebSearch,
      sources: aiResponse.sources
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
      emergencyOverride: routingDecision.source === ROUTING_SOURCES.STORED,
      usedWebSearch: Boolean(aiResponse?.usedWebSearch),
      sources: aiResponse?.sources || [],
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
