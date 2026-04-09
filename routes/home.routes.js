import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getHome } from '../controllers/user.controller.js';

const router = Router();

router.get('/', requireAuth('user'), getHome);

export default router;
