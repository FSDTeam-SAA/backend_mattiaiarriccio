import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from '../controllers/user.controller.js';

const router = Router();

router.use(requireAuth('user'));
router.get('/', listNotifications);
router.post('/', createNotification);
// Static path registered before the parameterised `/:notificationId/read`
// route so param matching can't shadow it.
router.patch('/mark-all-as-read', markAllNotificationsRead);
router.patch('/:notificationId/read', markNotificationRead);

export default router;
