import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import User from '../models/user.model.js';
import Session from '../models/session.model.js';
import PasswordReset from '../models/passwordReset.model.js';
import { createId } from '../lib/id.js';
import { logActivity } from '../services/activity.service.js';
import {
  ensureEmail,
  ensurePasswordStrength,
  ensureConfirmedPassword,
  verifyPassword,
  hashPassword,
  createOpaqueToken,
  createOtpCode,
  maskEmail,
  hoursFromNow,
  minutesFromNow,
  OTP_TTL_MINUTES,
  SESSION_TTL_HOURS
} from '../services/security.service.js';
import { resolveImageUrl } from '../services/media.service.js';
import { sendSuccess } from '../utils/response.js';
import { publicUser } from '../utils/serializers.js';

const pickFirstDefined = (body, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return String(body[key] || '').trim();
    }
  }

  return '';
};

const resolveUserName = (body = {}) =>
  pickFirstDefined(body, ['username', 'userName', 'fullName', 'firstName']);

const normalizeName = (firstName, lastName) =>
  `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();

const createSessionPayload = async (user) => {
  const session = await Session.create({
    _id: createId('session'),
    userId: user._id,
    role: user.role,
    token: createOpaqueToken(),
    expiresAt: hoursFromNow(SESSION_TTL_HOURS)
  });

  return {
    accessToken: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user)
  };
};

const createPasswordResetRequest = async (user) => {
  await PasswordReset.deleteMany({
    userId: user._id,
    role: user.role,
    consumedAt: null
  });

  return PasswordReset.create({
    _id: createId('reset'),
    userId: user._id,
    role: user.role,
    email: user.email,
    otpCode: createOtpCode(),
    expiresAt: minutesFromNow(OTP_TTL_MINUTES)
  });
};

export const register = catchAsync(async (req, res) => {
  const firstName = resolveUserName(req.body);
  const lastName = String(req.body.lastName || '').trim();
  const phoneNumber = String(req.body.phoneNumber || '').trim();
  const preferredLanguage = String(req.body.preferredLanguage || 'en').trim();
  const email = ensureEmail(req.body.email);
  const password = ensurePasswordStrength(req.body.password);
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!firstName) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Username is required');
  }

  ensureConfirmedPassword(password, confirmPassword);

  const resolvedAvatarUrl = await resolveImageUrl({
    req,
    folder: 'users/avatars',
    fieldNames: ['avatar', 'avatarImage', 'avatarUrl'],
    bodyValue: req.body.avatarUrl,
    defaultValue: 'https://placehold.co/160x160/png?text=USER'
  });

  const existingUser = await User.findOne({ email, role: 'user' }).lean();

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'An account with this email already exists');
  }

  const user = await User.create({
    _id: createId('user'),
    role: 'user',
    firstName,
    lastName,
    fullName: normalizeName(firstName, lastName),
    email,
    phoneNumber,
    avatarUrl: resolvedAvatarUrl,
    preferredLanguage,
    notificationsEnabled: true,
    onboardingCompleted: false,
    passwordHash: await hashPassword(password)
  });

  await logActivity({
    type: 'user.registered',
    actorId: user._id,
    title: `New user registered: ${user.fullName}`,
    description: `${user.email} created a mobile account.`
  });

  const sessionPayload = await createSessionPayload(user);

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'User registered successfully',
    data: sessionPayload
  });
});

export const login = (role) =>
  catchAsync(async (req, res) => {
    const email = ensureEmail(req.body.email);
    const password = String(req.body.password || '');

    const user = await User.findOne({ email, role });

    if (!user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid email or password');
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);

    if (!passwordMatches) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid email or password');
    }

    const sessionPayload = await createSessionPayload(user);

    sendSuccess(res, {
      message: `${role === 'admin' ? 'Admin' : 'User'} logged in successfully`,
      data: sessionPayload
    });
  });

export const socialLogin = catchAsync(async (req, res) => {
  const provider = String(req.body.provider || '').trim().toLowerCase();
  const email = ensureEmail(req.body.email);
  const fullName = String(req.body.fullName || '').trim();
  const avatarUrl = String(req.body.avatarUrl || '').trim();

  if (!provider) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'provider is required');
  }

  if (!fullName) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'fullName is required');
  }

  const [firstName, ...rest] = fullName.split(' ');
  const lastName = rest.join(' ');
  const resolvedAvatarUrl = await resolveImageUrl({
    req,
    folder: 'users/avatars',
    fieldNames: ['avatar', 'avatarImage', 'avatarUrl'],
    bodyValue: avatarUrl,
    currentValue: undefined,
    defaultValue: 'https://placehold.co/160x160/png?text=SOCIAL'
  });

  let user = await User.findOne({ email, role: 'user' });

  if (!user) {
    user = await User.create({
      _id: createId('user'),
      role: 'user',
      firstName,
      lastName,
      fullName,
      email,
      phoneNumber: '',
      avatarUrl: resolvedAvatarUrl,
      preferredLanguage: 'en',
      notificationsEnabled: true,
      onboardingCompleted: true,
      passwordHash: await hashPassword(createOpaqueToken(12))
    });
  } else {
    user.firstName = firstName;
    user.lastName = lastName;
    user.fullName = fullName;
    user.avatarUrl = await resolveImageUrl({
      req,
      folder: 'users/avatars',
      fieldNames: ['avatar', 'avatarImage', 'avatarUrl'],
      bodyValue: avatarUrl,
      currentValue: user.avatarUrl
    });
    await user.save();
  }

  await logActivity({
    type: 'user.social-login',
    actorId: user._id,
    title: `${provider} sign-in completed`,
    description: `${user.email} authenticated through ${provider}.`
  });

  const sessionPayload = await createSessionPayload(user);

  sendSuccess(res, {
    message: 'Social login completed successfully',
    data: sessionPayload
  });
});

export const requestPasswordReset = (role) =>
  catchAsync(async (req, res) => {
    const email = ensureEmail(req.body.email);
    const user = await User.findOne({ email, role });

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'No account found with that email');
    }

    const resetRequest = await createPasswordResetRequest(user);

    const data = {
      requestId: resetRequest._id,
      email,
      maskedDestination: maskEmail(email),
      expiresAt: resetRequest.expiresAt
    };

    if (process.env.NODE_ENV !== 'production') {
      data.debugOtp = resetRequest.otpCode;
    }

    sendSuccess(res, {
      message: 'Password reset OTP created successfully',
      data
    });
  });

export const verifyPasswordResetOtp = (role) =>
  catchAsync(async (req, res) => {
    const email = ensureEmail(req.body.email);
    const otpCode = String(req.body.otpCode || '').trim();

    if (!otpCode) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'otpCode is required');
    }

    const resetRequest = await PasswordReset.findOne({
      email,
      role,
      otpCode,
      consumedAt: null
    });

    if (!resetRequest) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid OTP code');
    }

    if (new Date(resetRequest.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP code has expired');
    }

    resetRequest.verifiedAt = new Date();
    resetRequest.resetToken = createOpaqueToken();
    await resetRequest.save();

    sendSuccess(res, {
      message: 'OTP verified successfully',
      data: {
        requestId: resetRequest._id,
        resetToken: resetRequest.resetToken,
        expiresAt: resetRequest.expiresAt
      }
    });
  });

export const resetPassword = (role) =>
  catchAsync(async (req, res) => {
    const email = ensureEmail(req.body.email);
    const resetToken = String(req.body.resetToken || '').trim();
    const password = ensurePasswordStrength(req.body.password);
    const confirmPassword = String(req.body.confirmPassword || '');

    ensureConfirmedPassword(password, confirmPassword);

    if (!resetToken) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'resetToken is required');
    }

    const resetRequest = await PasswordReset.findOne({
      email,
      role,
      resetToken,
      consumedAt: null
    });

    if (!resetRequest || !resetRequest.verifiedAt) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid password reset token');
    }

    if (new Date(resetRequest.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Password reset token has expired');
    }

    const user = await User.findById(resetRequest.userId);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'User account no longer exists');
    }

    user.passwordHash = await hashPassword(password);
    await user.save();

    resetRequest.consumedAt = new Date();
    await resetRequest.save();

    await Session.deleteMany({ userId: user._id });

    await logActivity({
      type: 'password.reset',
      actorId: user._id,
      title: `${role === 'admin' ? 'Admin' : 'User'} password reset`,
      description: `${user.email} reset the account password.`
    });

    sendSuccess(res, {
      message: 'Password reset successfully'
    });
  });

export const logout = catchAsync(async (req, res) => {
  await Session.deleteOne({ _id: req.auth.session._id });

  sendSuccess(res, {
    message: 'Logged out successfully'
  });
});
