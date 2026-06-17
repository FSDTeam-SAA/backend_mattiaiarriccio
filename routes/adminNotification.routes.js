import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { listNotifications } from '../controllers/adminNotification.controller.js';

const router = Router();

router.use(requireAuth('admin'));

router.get('/', listNotifications);

export default router;
