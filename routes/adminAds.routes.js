import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  getAdSettings,
  updateAdSettings
} from '../controllers/adminAds.controller.js';

const router = Router();

router.use(requireAuth('admin'));

router.get('/', getAdSettings);
router.patch('/', updateAdSettings);

export default router;
