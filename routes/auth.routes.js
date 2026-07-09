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
import { rateLimit } from '../middlewares/rateLimit.js';
import upload from '../middlewares/upload.js';

const router = Router();

const avatarUpload = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'avatarImage', maxCount: 1 },
  { name: 'avatarUrl', maxCount: 1 }
]);

// Brute-force protection on credential/OTP endpoints. Limits are generous
// enough never to hit a real user, but stop password/OTP guessing and reset
// spam from a single client. (Relies on `trust proxy` so req.ip is the real
// client behind nginx/devtunnel — set in app.js.)
const credentialsLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: 'Too many attempts. Please wait a minute and try again.'
});
const otpRequestLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: 'Too many reset requests. Please wait a minute and try again.'
});

router.post('/register', credentialsLimiter, avatarUpload, register);
router.post('/login', credentialsLimiter, login('user'));
router.post('/admin/login', credentialsLimiter, login('admin'));
router.post('/social-login', credentialsLimiter, avatarUpload, socialLogin);
router.post('/refresh-token', refreshToken);

router.post('/password-reset/request', otpRequestLimiter, requestPasswordReset('user'));
router.post('/password-reset/verify', credentialsLimiter, verifyPasswordResetOtp('user'));
router.post('/password-reset/reset', credentialsLimiter, resetPassword('user'));

router.post('/admin/password-reset/request', otpRequestLimiter, requestPasswordReset('admin'));
router.post('/admin/password-reset/verify', credentialsLimiter, verifyPasswordResetOtp('admin'));
router.post('/admin/password-reset/reset', credentialsLimiter, resetPassword('admin'));

router.post('/logout', requireAuth('user', 'admin'), logout);

export default router;
