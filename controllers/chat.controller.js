import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Conversation from '../models/conversation.model.js';
import { requestAiReply, getAiServiceInfo } from '../services/ai.service.js';
import { sendSuccess } from '../utils/response.js';
import { summarizeText } from '../services/security.service.js';
import { createId } from '../lib/id.js';

const summarizeConversation = (conversation) => ({
  id: conversation._id,
  title: conversation.title,
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
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  messages: conversation.messages.map((message) => ({
    id: message._id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  }))
});

const buildAiQuery = (conversation, latestMessage) => {
  const history = conversation?.messages?.slice(-6) || [];

  if (history.length === 0) {
    return latestMessage;
  }

  const formattedHistory = history
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n');

  return `Use the recent emergency conversation context below if it is relevant.\n${formattedHistory}\n\nLatest user request:\n${latestMessage}`;
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
  const message = String(req.body.message || '').trim();
  const requestedConversationId = String(req.body.conversationId || '').trim();

  if (!message) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'message is required');
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

  const aiResponse = await requestAiReply({
    userId: req.auth.user._id,
    query: buildAiQuery(conversation?.toObject(), message)
  });

  if (!conversation) {
    conversation = await Conversation.create({
      _id: createId('conv'),
      userId: req.auth.user._id,
      title: summarizeText(message, 42),
      messages: []
    });
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
