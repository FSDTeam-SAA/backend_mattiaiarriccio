import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { getSetting } from '../services/settings.service.js';
import { isPremiumUser } from '../services/premium.service.js';

const SUPPORTED_PLATFORMS = ['android', 'ios'];

const resolvePlatform = (req) => {
  const raw = String(
    req.query.platform || req.headers['x-app-platform'] || ''
  )
    .trim()
    .toLowerCase();

  return SUPPORTED_PLATFORMS.includes(raw) ? raw : null;
};

/**
 * App-facing ad configuration. Tells the Flutter client whether to show ads at
 * all, in which format/placements, the native interleave frequency, and the
 * AdMob unit ids it should load. Premium users are always ad-free, so
 * `showAds` is false for them even when the master switch is on.
 */
export const getAdConfig = catchAsync(async (req, res) => {
  const [adsEnabled, adConfig, admUnitIds] = await Promise.all([
    getSetting('adsEnabled'),
    getSetting('adConfig'),
    getSetting('admUnitIds')
  ]);

  const showAds = adsEnabled === true && !isPremiumUser(req.auth.user);

  const platform = resolvePlatform(req);
  const unitIds =
    platform && admUnitIds && typeof admUnitIds === 'object'
      ? admUnitIds[platform] || {}
      : admUnitIds;

  sendSuccess(res, {
    message: 'Ad configuration fetched successfully',
    data: {
      showAds,
      format: adConfig?.format ?? 'banner',
      placements: Array.isArray(adConfig?.placements) ? adConfig.placements : [],
      nativeFrequency: adConfig?.nativeFrequency ?? 5,
      unitIds: unitIds ?? {}
    }
  });
});
