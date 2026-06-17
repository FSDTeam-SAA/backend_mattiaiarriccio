import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  verifySubscription,
  listMySubscriptions
} from '../controllers/subscription.controller.js';

const router = Router();

router.use(requireAuth('user'));

router.post('/verify', verifySubscription);
router.get('/', listMySubscriptions);

export default router;
