import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { getWebSearchUsageSummary } from '../services/webSearch.service.js';
import { getSetting } from '../services/settings.service.js';
import { parseIntegerInput } from '../utils/requestParsers.js';

/**
 * Admin: GET /api/v1/admin/web-search-usage?days=
 *
 * Deliberately simple counters (today / this month / total), not analytics -
 * the point is to see real usage and estimate running cost before deciding on
 * a larger Phase 2. The current limits are returned alongside so the dashboard
 * can show usage against allowance without a second request.
 */
export const getWebSearchUsage = catchAsync(async (req, res) => {
  const requestedDays = parseIntegerInput(req.query.days) ?? 30;
  const days = Math.min(Math.max(requestedDays, 1), 90);

  const [
    summary,
    enabled,
    freeLimit,
    premiumLimit,
    freeWeeklyLimit,
    premiumWeeklyLimit
  ] = await Promise.all([
    getWebSearchUsageSummary({ days }),
    getSetting('webSearchEnabled'),
    getSetting('webSearchFreeDailyLimit'),
    getSetting('webSearchPremiumDailyLimit'),
    getSetting('webSearchFreeWeeklyLimit'),
    getSetting('webSearchPremiumWeeklyLimit')
  ]);

  sendSuccess(res, {
    message: 'Web search usage fetched successfully',
    data: {
      ...summary,
      enabled,
      freeDailyLimit: freeLimit,
      premiumDailyLimit: premiumLimit,
      freeWeeklyLimit,
      premiumWeeklyLimit
    }
  });
});
