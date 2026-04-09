import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getLegalDocument } from '../controllers/user.controller.js';

const router = Router();

router.get('/:slug', requireAuth('user', 'admin'), getLegalDocument);

export default router;
