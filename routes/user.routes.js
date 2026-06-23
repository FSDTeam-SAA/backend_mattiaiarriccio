import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';
import {
  changePassword,
  deleteAccount,
  getCurrentUser,
  getUserPreferences,
  updateCurrentUser,
  updateUserPreferences
} from '../controllers/user.controller.js';

const router = Router();
const avatarUpload = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'avatarImage', maxCount: 1 },
  { name: 'avatarUrl', maxCount: 1 }
]);

router.use(requireAuth('user'));

router.get('/me', getCurrentUser);
router.patch('/me', avatarUpload, updateCurrentUser);
router.get('/me/preferences', getUserPreferences);
router.patch('/me/preferences', updateUserPreferences);
router.patch('/me/password', changePassword);
router.delete('/me', deleteAccount);

export default router;
