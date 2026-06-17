import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { getAllSettings, updateSettings, getSettingKeys } from '../services/settings.service.js';
import { logAudit } from '../services/audit.service.js';

/**
 * Returns the full resolved app configuration (defaults merged with DB overrides):
 * freeDailyMessageLimit, freeDailyChatLimit, freePrompt, premiumPrompt, accessRules,
 * adsEnabled, adConfig, admUnitIds, emergencyOverrideEnabled, reminderDefaults,
 * notificationsEnabled.
 */
export const getAppSettings = catchAsync(async (req, res) => {
  const settings = await getAllSettings();
  sendSuccess(res, { message: 'Settings fetched successfully', data: settings });
});

/**
 * Patches any subset of settings keys. Each key is validated by settings.service
 * (updateSettings -> updateSetting), which throws ApiError(400) on invalid values
 * or unknown keys.
 */
export const updateAppSettings = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const patch = req.body || {};

  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Provide at least one setting to update');
  }

  const unknown = Object.keys(patch).filter((key) => !getSettingKeys().includes(key));
  if (unknown.length > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unknown setting key(s): ${unknown.join(', ')}`
    );
  }

  await updateSettings(patch, adminId);
  await logAudit({ adminId, action: 'app_settings.update', meta: { keys: Object.keys(patch) } });

  const settings = await getAllSettings();
  sendSuccess(res, { message: 'Settings updated successfully', data: settings });
});
