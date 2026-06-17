import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getAppSettings, updateAppSettings } from '../controllers/adminSettings.controller.js';

const router = Router();

router.use(requireAuth('admin'));

router.get('/', getAppSettings);
router.patch('/', updateAppSettings);

export default router;
