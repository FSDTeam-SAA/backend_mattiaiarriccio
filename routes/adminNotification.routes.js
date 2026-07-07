import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  createNotificationTemplate,
  deleteNotificationTemplate,
  listNotificationTemplates,
  listNotifications,
  sendAdminNotification,
  updateNotificationTemplate
} from '../controllers/adminNotification.controller.js';

const router = Router();

router.use(requireAuth('admin'));

router.get('/templates', listNotificationTemplates);
router.post('/templates', createNotificationTemplate);
router.post('/templates/:templateId/send', sendAdminNotification);
router.patch('/templates/:templateId', updateNotificationTemplate);
router.delete('/templates/:templateId', deleteNotificationTemplate);
router.post('/send', sendAdminNotification);
router.get('/', listNotifications);

export default router;
