import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { enforceDailyLimit } from '../middlewares/dailyLimit.js';
import {
  deleteConversation,
  getConversationById,
  listConversations,
  sendChatMessage,
  sendChatMessageStream
} from '../controllers/chat.controller.js';

const router = Router();

const enforceChatLimit = enforceDailyLimit('chats');
const enforceMessageLimit = enforceDailyLimit('messages');

/**
 * A brand-new conversation is started only when the request carries no existing
 * conversationId. In that case we also count it against the daily CHAT limit;
 * otherwise the chat-limit middleware is skipped (only the message limit runs).
 * Premium users are skipped automatically inside enforceDailyLimit.
 */
const enforceChatLimitForNewConversation = (req, res, next) => {
  const conversationId = String(
    req.body?.conversationId ?? req.body?.conversation_id ?? ''
  ).trim();

  if (conversationId) {
    return next();
  }

  return enforceChatLimit(req, res, next);
};

router.use(requireAuth('user'));

router.get('/conversations', listConversations);
router.get('/history', listConversations);
router.get('/conversations/:conversationId', getConversationById);
router.post(
  '/messages/stream',
  enforceChatLimitForNewConversation,
  enforceMessageLimit,
  sendChatMessageStream
);
router.post(
  '/messages',
  enforceChatLimitForNewConversation,
  enforceMessageLimit,
  sendChatMessage
);
router.delete('/conversations/:conversationId', deleteConversation);

export default router;
