import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  createNotification,
  listNotifications,
  markNotificationRead
} from '../controllers/user.controller.js';

const router = Router();

router.use(requireAuth('user'));
router.get('/', listNotifications);
router.post('/', createNotification);
router.patch('/:notificationId/read', markNotificationRead);

export default router;
