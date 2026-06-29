import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Conversation from '../models/conversation.model.js';
import {
  requestAiReply,
  requestAiReplyStream,
  getAiServiceInfo,
  DEFAULT_AI_EMERGENCY_TYPE
} from '../services/ai.service.js';
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

  return {
    requestedLanguage,
    requestedEmergencyType,
    requestedConversationId,
    message,
    conversation,
    effectiveEmergencyType,
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

const buildAssistantMessage = ({ content, routingDecision }) => ({
  _id: createId('msg'),
  role: 'assistant',
  content,
  ...routingMetadata(routingDecision),
  createdAt: new Date()
});

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

  const aiResponse = routingDecision.source === ROUTING_SOURCES.STORED
    ? {
        reply: routingDecision.matchedPlaybook.responseTemplate,
        emergency: true
      }
    : await requestAiReply({
        emergencyType: chat.effectiveEmergencyType,
        language: chat.requestedLanguage,
        query: buildRoutedAiQuery(chat, routingDecision),
        caller: req.auth.user,
        fallbackReply: routingDecision.matchedPlaybook?.responseTemplate || ''
      });

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
    routingDecision
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

    setSseHeaders(res);
    writeSseEvent(res, 'meta', {
      conversationId: conversation._id,
      emergencyType: conversation.emergencyType || '',
      language: conversation.language || 'en',
      userMessage: serializeMessage(userMessage),
      aiSource: getAiServiceInfo(),
      emergencyOverride: routingDecision.source === ROUTING_SOURCES.STORED,
      ...routeMeta
    });

    let aiResponse;
    if (routingDecision.source === ROUTING_SOURCES.STORED) {
      aiResponse = {
        reply: routingDecision.matchedPlaybook.responseTemplate,
        emergency: true
      };
      writeSseEvent(res, 'delta', {
        text: routingDecision.matchedPlaybook.responseTemplate
      });
    } else {
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
      routingDecision
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
