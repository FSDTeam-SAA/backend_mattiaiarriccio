import { StatusCodes } from 'http-status-codes';
import { OAuth2Client } from 'google-auth-library';
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
  isExpired,
  OTP_TTL_MINUTES,
  SESSION_TTL_HOURS
} from '../services/security.service.js';
import { resolveImageUrl } from '../services/media.service.js';
import { sendPasswordResetOtpEmail } from '../services/email.service.js';
import {
  ensureSupportedLanguage,
  messageFor,
  resolveRequestLanguage
} from '../services/language.service.js';
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

const verifyGoogleProfile = async ({ idToken, accessToken }) => {
  const cleanedIdToken = String(idToken || '').trim();
  const cleanedAccessToken = String(accessToken || '').trim();

  if (!cleanedIdToken && !cleanedAccessToken) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Google idToken or accessToken is required'
    );
  }

  const webClientId = (process.env.GOOGLE_WEB_CLIENT_ID || '').trim();
  const androidClientId = (process.env.GOOGLE_ANDROID_CLIENT_ID || '').trim();
  const iosClientId = (process.env.GOOGLE_IOS_CLIENT_ID || '').trim();
  const additionalClientIds = String(process.env.GOOGLE_ALLOWED_CLIENT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!webClientId) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Google sign-in is not configured. Set GOOGLE_WEB_CLIENT_ID on the backend.'
    );
  }

  const allowedAudiences = Array.from(
    new Set([webClientId, androidClientId, iosClientId, ...additionalClientIds].filter(Boolean))
  );

  if (cleanedIdToken) {
    const client = new OAuth2Client(webClientId);
    let ticket;

    try {
      ticket = await client.verifyIdToken({
        idToken: cleanedIdToken,
        audience: allowedAudiences
      });
    } catch (strictErr) {
      console.error('[Google Auth] ID token verify failed:', strictErr?.message);

      if (!cleanedAccessToken) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          process.env.NODE_ENV !== 'production'
            ? `Google token error: ${strictErr?.message}`
            : 'Invalid Google sign-in token'
        );
      }
    }

    if (ticket) {
      const payload = ticket.getPayload();

      if (!payload?.email) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google account email is missing');
      }

      if (payload.email_verified === false) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google account email is not verified');
      }

      const email = ensureEmail(payload.email);
      const fullName =
        String(payload.name || normalizeName(payload.given_name, payload.family_name)).trim() ||
        email.split('@')[0];

      return {
        email,
        fullName,
        avatarUrl: String(payload.picture || '').trim()
      };
    }
  }

  // Fallback path: verify Google access token and fetch canonical user profile.
  // This supports clients/environments where ID token verification is unavailable.
  try {
    const profileResponse = await new OAuth2Client().request({
      url: 'https://www.googleapis.com/oauth2/v3/userinfo',
      headers: { Authorization: `Bearer ${cleanedAccessToken}` }
    });
    const profile = profileResponse.data || {};

    if (!profile?.email) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google account email is missing');
    }

    if (profile.email_verified === false) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google account email is not verified');
    }

    const email = ensureEmail(profile.email);
    const fullName =
      String(profile.name || normalizeName(profile.given_name, profile.family_name)).trim() ||
      email.split('@')[0];

    return {
      email,
      fullName,
      avatarUrl: String(profile.picture || '').trim()
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      process.env.NODE_ENV !== 'production'
        ? `Google access token error: ${error?.message || 'Unknown error'}`
        : 'Invalid Google sign-in token'
    );
  }
};

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
    refreshToken: session.token,
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
  const preferredLanguage = ensureSupportedLanguage(
    req.body.preferredLanguage || resolveRequestLanguage(req)
  );
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
    message: messageFor(preferredLanguage, 'registered'),
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
    const language = resolveRequestLanguage(req, user.preferredLanguage);

    sendSuccess(res, {
      message: messageFor(language, 'loggedIn', role),
      data: sessionPayload
    });
  });

export const socialLogin = catchAsync(async (req, res) => {
  const idToken = pickFirstDefined(req.body, ['idToken', 'id_token', 'token']);
  const accessToken = pickFirstDefined(req.body, [
    'accessToken',
    'access_token',
    'googleAccessToken'
  ]);

  console.log('[Social Login] provider:', req.body.provider);
  console.log('[Social Login] email:', req.body.email);
  console.log('[Social Login] idToken received:', !!idToken, '| length:', idToken.length);
  console.log(
    '[Social Login] accessToken received:',
    !!accessToken,
    '| length:',
    accessToken.length
  );
  console.log('[Social Login] GOOGLE_WEB_CLIENT_ID set:', !!process.env.GOOGLE_WEB_CLIENT_ID);

  const provider = String(req.body.provider || '').trim().toLowerCase();
  const preferredLanguage = ensureSupportedLanguage(
    req.body.preferredLanguage || resolveRequestLanguage(req)
  );

  if (!provider) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'provider is required');
  }

  if (provider !== 'google') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unsupported social provider');
  }

  const googleProfile = await verifyGoogleProfile({ idToken, accessToken });
  const email = googleProfile.email;
  const fullName = googleProfile.fullName;
  const avatarUrl =
    googleProfile.avatarUrl || String(req.body.avatarUrl || req.body.avatar || '').trim();

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
      preferredLanguage,
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
    user.preferredLanguage = preferredLanguage;
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
    message: messageFor(preferredLanguage, 'socialLogin'),
    data: sessionPayload
  });
});

export const refreshToken = catchAsync(async (req, res) => {
  const refreshTokenValue = String(req.body.refreshToken || '').trim();

  if (!refreshTokenValue) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'refreshToken is required');
  }

  const session = await Session.findOne({ token: refreshTokenValue });

  if (!session || isExpired(session.expiresAt)) {
    if (session) {
      await Session.deleteOne({ _id: session._id });
    }
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired refresh token');
  }

  session.token = createOpaqueToken();
  session.expiresAt = hoursFromNow(SESSION_TTL_HOURS);
  await session.save();

  const user = await User.findById(session.userId).lean();
  const language = resolveRequestLanguage(req, user?.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'loggedIn', session.role),
    data: {
      accessToken: session.token,
      refreshToken: session.token,
      expiresAt: session.expiresAt,
      user: publicUser(user)
    }
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
    await sendPasswordResetOtpEmail({
      toEmail: email,
      otpCode: resetRequest.otpCode,
      expiresInMinutes: OTP_TTL_MINUTES
    });

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
    const otpCode = String(req.body.otpCode || req.body.otp || '').trim();

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
    const resetToken = String(req.body.resetToken || req.body.otp || '').trim();
    const password = ensurePasswordStrength(req.body.password);
    const confirmPassword = String(req.body.confirmPassword || '');

    ensureConfirmedPassword(password, confirmPassword);

    if (!resetToken) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'resetToken is required');
    }

    const resetRequest = await PasswordReset.findOne({
      email,
      role,
      consumedAt: null,
      $or: [{ resetToken }, { otpCode: resetToken }]
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
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'loggedOut')
  });
});
