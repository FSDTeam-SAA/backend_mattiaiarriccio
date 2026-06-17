import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { getSetting, updateSetting } from '../services/settings.service.js';
import { logAudit } from '../services/audit.service.js';

/**
 * Returns the current ad-related settings for the admin console.
 */
export const getAdSettings = catchAsync(async (req, res) => {
  const [adsEnabled, adConfig, admUnitIds] = await Promise.all([
    getSetting('adsEnabled'),
    getSetting('adConfig'),
    getSetting('admUnitIds')
  ]);

  sendSuccess(res, {
    message: 'Ad settings fetched successfully',
    data: { adsEnabled, adConfig, admUnitIds }
  });
});

/**
 * Updates any subset of { adsEnabled, adConfig, admUnitIds }. Each key is
 * validated + persisted by settings.service.updateSetting (which throws an
 * ApiError on bad input). At least one key must be present.
 */
export const updateAdSettings = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const { adsEnabled, adConfig, admUnitIds } = req.body;

  const hasAdsEnabled = adsEnabled !== undefined;
  const hasAdConfig = adConfig !== undefined;
  const hasAdmUnitIds = admUnitIds !== undefined;

  if (!hasAdsEnabled && !hasAdConfig && !hasAdmUnitIds) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Provide at least one of: adsEnabled, adConfig, admUnitIds'
    );
  }

  if (hasAdsEnabled) {
    await updateSetting('adsEnabled', adsEnabled, adminId);
  }

  if (hasAdConfig) {
    await updateSetting('adConfig', adConfig, adminId);
  }

  if (hasAdmUnitIds) {
    await updateSetting('admUnitIds', admUnitIds, adminId);
  }

  const [nextAdsEnabled, nextAdConfig, nextAdmUnitIds] = await Promise.all([
    getSetting('adsEnabled'),
    getSetting('adConfig'),
    getSetting('admUnitIds')
  ]);

  await logAudit({
    adminId,
    action: 'settings.ad_config.update',
    meta: {
      updated: {
        adsEnabled: hasAdsEnabled,
        adConfig: hasAdConfig,
        admUnitIds: hasAdmUnitIds
      },
      adsEnabled: nextAdsEnabled,
      adConfig: nextAdConfig,
      admUnitIds: nextAdmUnitIds
    }
  });

  sendSuccess(res, {
    message: 'Ad settings updated successfully',
    data: {
      adsEnabled: nextAdsEnabled,
      adConfig: nextAdConfig,
      admUnitIds: nextAdmUnitIds
    }
  });
});
