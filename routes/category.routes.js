import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { listCategoriesForUser } from '../controllers/category.controller.js';

const router = Router();

router.get('/', requireAuth('user'), listCategoriesForUser);

export default router;
