import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  deleteChecklistItem,
  getChecklistById,
  listChecklists,
  updateChecklist,
  updateChecklistItem
} from '../controllers/checklist.controller.js';

const router = Router();
const checklistMediaUpload = upload.fields([
  { name: 'icon', maxCount: 1 },
  { name: 'iconImage', maxCount: 1 },
  { name: 'iconUrl', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 },
  { name: 'coverImageUrl', maxCount: 1 }
]);

router.use(requireAuth('user'));

router.get('/', listChecklists);
router.post('/', checklistMediaUpload, createChecklist);
router.get('/:checklistId', getChecklistById);
router.patch('/:checklistId', checklistMediaUpload, updateChecklist);
router.delete('/:checklistId', deleteChecklist);
router.post('/:checklistId/items', addChecklistItem);
router.patch('/:checklistId/items/:itemId', updateChecklistItem);
router.delete('/:checklistId/items/:itemId', deleteChecklistItem);

export default router;
