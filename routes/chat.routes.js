import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  deleteConversation,
  getConversationById,
  listConversations,
  sendChatMessage
} from '../controllers/chat.controller.js';

const router = Router();

router.use(requireAuth('user'));

router.get('/conversations', listConversations);
router.get('/history', listConversations);
router.get('/conversations/:conversationId', getConversationById);
router.post('/messages', sendChatMessage);
router.delete('/conversations/:conversationId', deleteConversation);

export default router;
