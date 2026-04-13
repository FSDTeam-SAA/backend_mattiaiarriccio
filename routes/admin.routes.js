import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';
import {
  createAdminCategory,
  createAdminChecklist,
  createAdminSafetyTip,
  deleteAdminCategory,
  deleteAdminChecklist,
  deleteAdminSafetyTip,
  getAdminDashboard,
  getAdminSettings,
  getAiPromptConfig,
  listAdminCategories,
  listAdminActivity,
  listAdminChecklists,
  listAdminSafetyTips,
  patchAiPromptConfig,
  updateAdminCategory,
  updateAdminChecklist,
  updateAdminSafetyTip,
  updateAdminSettings
} from '../controllers/admin.controller.js';

const router = Router();
const avatarUpload = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'avatarImage', maxCount: 1 },
  { name: 'avatarUrl', maxCount: 1 }
]);
const checklistMediaUpload = upload.fields([
  { name: 'icon', maxCount: 1 },
  { name: 'iconImage', maxCount: 1 },
  { name: 'iconUrl', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 },
  { name: 'coverImageUrl', maxCount: 1 }
]);
const safetyTipMediaUpload = upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 },
  { name: 'coverImageUrl', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'thumbnailImage', maxCount: 1 },
  { name: 'thumbnailUrl', maxCount: 1 }
]);

router.use(requireAuth('admin'));

router.get('/dashboard', getAdminDashboard);
router.get('/settings', getAdminSettings);
router.patch('/settings', avatarUpload, updateAdminSettings);

router.get('/ai-prompt', getAiPromptConfig);
router.patch('/ai-prompt', patchAiPromptConfig);

router.get('/categories', listAdminCategories);
router.post('/categories', createAdminCategory);
router.patch('/categories/:categoryId', updateAdminCategory);
router.delete('/categories/:categoryId', deleteAdminCategory);

router.get('/checklists', listAdminChecklists);
router.post('/checklists', checklistMediaUpload, createAdminChecklist);
router.patch('/checklists/:checklistId', checklistMediaUpload, updateAdminChecklist);
router.delete('/checklists/:checklistId', deleteAdminChecklist);

router.get('/safety-tips', listAdminSafetyTips);
router.post('/safety-tips', safetyTipMediaUpload, createAdminSafetyTip);
router.patch('/safety-tips/:tipId', safetyTipMediaUpload, updateAdminSafetyTip);
router.delete('/safety-tips/:tipId', deleteAdminSafetyTip);

router.get('/activity', listAdminActivity);

export default router;
