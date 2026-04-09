import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getSafetyTipById, listSafetyTips } from '../controllers/safetyTip.controller.js';

const router = Router();

router.use(requireAuth('user', 'admin'));
router.get('/', listSafetyTips);
router.get('/:tipId', getSafetyTipById);

export default router;
