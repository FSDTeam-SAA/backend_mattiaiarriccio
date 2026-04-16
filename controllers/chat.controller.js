import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Conversation from '../models/conversation.model.js';
import {
  requestAiReply,
  getAiServiceInfo,
  DEFAULT_AI_EMERGENCY_TYPE
} from '../services/ai.service.js';
import { sendSuccess } from '../utils/response.js';
import { summarizeText } from '../services/security.service.js';
import { createId } from '../lib/id.js';

const summarizeConversation = (conversation) => ({
  id: conversation._id,
  title: conversation.title,
  emergencyType: conversation.emergencyType || '',
  messageCount: conversation.messages.length,
  lastMessagePreview:
    conversation.messages[conversation.messages.length - 1]?.content || '',
  updatedAt: conversation.updatedAt,
  createdAt: conversation.createdAt
});

const serializeConversation = (conversation) => ({
  id: conversation._id,
  title: conversation.title,
  userId: conversation.userId,
  emergencyType: conversation.emergencyType || '',
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  messages: conversation.messages.map((message) => ({
    id: message._id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  }))
});

const normalizeEmergencyType = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const resolveEmergencyType = (requestedEmergencyType, conversation) =>
  requestedEmergencyType ||
  normalizeEmergencyType(conversation?.emergencyType) ||
  DEFAULT_AI_EMERGENCY_TYPE;
const buildEmergencyAwareMessage = (message, emergencyType) => {
  const trimmedMessage = String(message || '').trim();

  if (trimmedMessage) {
    return trimmedMessage;
  }

  if (!emergencyType) {
    return '';
  }

  return `Help me with a ${emergencyType} emergency. Start with the most important immediate actions.`;
};

const buildAiQuery = ({ conversation, latestMessage, emergencyType, isNewConversation }) => {
  const history = conversation?.messages?.slice(-6) || [];
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
    'Use the recent emergency conversation context below if it is relevant.',
    formattedHistory,
    `Latest user request:\n${latestMessage}`
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const listConversations = catchAsync(async (req, res) => {
  const conversations = await Conversation.find({ userId: req.auth.user._id })
    .sort({ updatedAt: -1 })
    .lean();

  sendSuccess(res, {
    message: 'Chat history fetched successfully',
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

  sendSuccess(res, {
    message: 'Conversation fetched successfully',
    data: {
      ...serializeConversation(conversation),
      aiSource: getAiServiceInfo()
    }
  });
});

export const sendChatMessage = catchAsync(async (req, res) => {
  const requestedEmergencyType = normalizeEmergencyType(req.body.emergencyType);
  const message = buildEmergencyAwareMessage(req.body.message, requestedEmergencyType);
  const requestedConversationId = String(req.body.conversationId || '').trim();

  if (!message) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'message is required unless emergencyType is provided'
    );
  }

  let conversation = requestedConversationId
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

  const aiResponse = await requestAiReply({
    userId: req.auth.user._id,
    emergencyType: effectiveEmergencyType,
    query: buildAiQuery({
      conversation: conversation?.toObject(),
      latestMessage: message,
      emergencyType: effectiveEmergencyType,
      isNewConversation: !conversation
    })
  });

  if (!conversation) {
    conversation = await Conversation.create({
      _id: createId('conv'),
      userId: req.auth.user._id,
      title: summarizeText(
        requestedEmergencyType ? `${requestedEmergencyType} emergency` : message,
        42
      ),
      emergencyType: effectiveEmergencyType,
      messages: []
    });
  } else if (
    requestedEmergencyType ||
    !normalizeEmergencyType(conversation.emergencyType)
  ) {
    conversation.emergencyType = effectiveEmergencyType;
  }

  const userMessage = {
    _id: createId('msg'),
    role: 'user',
    content: message,
    createdAt: new Date()
  };

  const assistantMessage = {
    _id: createId('msg'),
    role: 'assistant',
    content: aiResponse.reply,
    createdAt: new Date()
  };

  conversation.messages.push(userMessage, assistantMessage);
  await conversation.save();

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Chat message processed successfully',
    data: {
      conversation: serializeConversation(conversation.toObject()),
      userMessage: {
        id: userMessage._id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt
      },
      assistantMessage: {
        id: assistantMessage._id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt
      },
      aiSource: getAiServiceInfo()
    }
  });
});

export const deleteConversation = catchAsync(async (req, res) => {
  const deletedConversation = await Conversation.findOneAndDelete({
    _id: req.params.conversationId,
    userId: req.auth.user._id
  });

  if (!deletedConversation) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Conversation not found');
  }

  sendSuccess(res, {
    message: 'Conversation deleted successfully'
  });
});
