import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { listMaterials } from '../controllers/adminMaterial.controller.js';

const router = Router();

router.use(requireAuth('admin'));

router.get('/', listMaterials);

export default router;
