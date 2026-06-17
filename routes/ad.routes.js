import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getAdConfig } from '../controllers/adConfig.controller.js';

const router = Router();

router.use(requireAuth('user'));

router.get('/', getAdConfig);

export default router;
