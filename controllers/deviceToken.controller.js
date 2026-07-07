import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import DeviceToken from '../models/deviceToken.model.js';
import { dispatchDueJobs } from '../services/reminder.service.js';

const ALLOWED_PLATFORMS = ['android', 'ios', 'web'];

/**
 * POST /api/v1/me/device-tokens
 * Body: { token: string, platform?: 'android'|'ios'|'web' }
 * Upserts a DeviceToken keyed by the (unique) token, claiming it for the caller
 * and updating its platform. Idempotent.
 */
export const registerDeviceToken = catchAsync(async (req, res) => {
  const user = req.auth.user;
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';

  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'token is required');
  }

  const rawPlatform =
    typeof req.body.platform === 'string' ? req.body.platform.trim().toLowerCase() : '';
  const platform = ALLOWED_PLATFORMS.includes(rawPlatform) ? rawPlatform : 'android';

  await DeviceToken.findOneAndUpdate(
    { token },
    { $set: { userId: user._id, platform }, $setOnInsert: { token } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // A token just registered — immediately deliver any due push jobs that were
  // waiting for it (e.g. an admin premium grant that fired before this device
  // had a token). Fire-and-forget + best-effort so registration stays fast and a
  // dispatch hiccup never fails the request. The scheduler is still the fallback.
  dispatchDueJobs().catch((error) =>
    console.error(
      '[deviceToken.controller] post-register dispatch failed:',
      error?.message || error
    )
  );

  sendSuccess(res, {
    message: 'Device token registered successfully',
    data: { ok: true }
  });
});

/**
 * DELETE /api/v1/me/device-tokens
 * Body: { token: string }
 * Deletes the caller's device token. Idempotent (returns ok even if not found).
 */
export const unregisterDeviceToken = catchAsync(async (req, res) => {
  const user = req.auth.user;
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';

  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'token is required');
  }

  await DeviceToken.deleteOne({ token, userId: user._id });

  sendSuccess(res, {
    message: 'Device token unregistered successfully',
    data: { ok: true }
  });
});
