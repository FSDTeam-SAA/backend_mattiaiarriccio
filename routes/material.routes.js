import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';
import {
  createMaterial,
  listMaterials,
  getMaterial,
  updateMaterial,
  deleteMaterial,
  markInspected
} from '../controllers/material.controller.js';

const router = Router();

const materialMediaUpload = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'imageFile', maxCount: 1 },
  { name: 'imageUrl', maxCount: 1 }
]);

router.use(requireAuth('user'));

router.get('/', listMaterials);
router.post('/', materialMediaUpload, createMaterial);
router.get('/:materialId', getMaterial);
router.patch('/:materialId', materialMediaUpload, updateMaterial);
router.delete('/:materialId', deleteMaterial);
router.post('/:materialId/mark-inspected', markInspected);

export default router;
