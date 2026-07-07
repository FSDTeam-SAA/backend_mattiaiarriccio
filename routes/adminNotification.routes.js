import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import {
  createNotificationTemplate,
  deleteNotificationTemplate,
  listNotificationTemplates,
  listNotifications,
  retryNotification,
  sendAdminNotification,
  updateNotificationTemplate
} from '../controllers/adminNotification.controller.js';

const router = Router();

router.use(requireAuth('admin'));

// Per-admin limits (auth has already populated req.auth). Idempotency still
// dedupes accidental repeats; this caps deliberate spamming.
const byAdmin = (req) => req.auth?.user?._id || req.ip || 'admin';
const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: byAdmin,
  message: 'Too many notification sends — please wait a minute'
});
const retryLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: byAdmin,
  message: 'Too many retries — please wait a minute'
});

router.get('/templates', listNotificationTemplates);
router.post('/templates', createNotificationTemplate);
router.post('/templates/:templateId/send', sendLimiter, sendAdminNotification);
router.patch('/templates/:templateId', updateNotificationTemplate);
router.delete('/templates/:templateId', deleteNotificationTemplate);
router.post('/send', sendLimiter, sendAdminNotification);
router.post('/:jobId/retry', retryLimiter, retryNotification);
router.get('/', listNotifications);

export default router;
