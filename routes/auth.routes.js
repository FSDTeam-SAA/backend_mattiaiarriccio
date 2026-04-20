import { Router } from 'express';
import {
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  refreshToken,
  socialLogin,
  verifyPasswordResetOtp
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';

const router = Router();

const avatarUpload = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'avatarImage', maxCount: 1 },
  { name: 'avatarUrl', maxCount: 1 }
]);

router.post('/register', avatarUpload, register);
router.post('/login', login('user'));
router.post('/admin/login', login('admin'));
router.post('/social-login', avatarUpload, socialLogin);
router.post('/refresh-token', refreshToken);

router.post('/password-reset/request', requestPasswordReset('user'));
router.post('/password-reset/verify', verifyPasswordResetOtp('user'));
router.post('/password-reset/reset', resetPassword('user'));

router.post('/admin/password-reset/request', requestPasswordReset('admin'));
router.post('/admin/password-reset/verify', verifyPasswordResetOtp('admin'));
router.post('/admin/password-reset/reset', resetPassword('admin'));

router.post('/logout', requireAuth('user', 'admin'), logout);

export default router;
