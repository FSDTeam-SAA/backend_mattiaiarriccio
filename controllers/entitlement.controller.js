import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import {
  entitlementSnapshot,
  isPremiumUser,
  recomputeTier
} from '../services/premium.service.js';
import {
  getSetting,
  getResolvedPaywallContent
} from '../services/settings.service.js';
import { resolveRequestLanguage } from '../services/language.service.js';
import {
  getCurrentUsageSnapshot,
  getUsageLimits,
  USAGE_KINDS
} from '../services/usageLimit.service.js';
import { getCustomChecklistQuota } from '../services/checklistQuota.service.js';

const publicLimit = (value) => (Number(value) === 0 ? null : Number(value));

/**
 * GET /api/v1/me/entitlements
 * Returns the caller's premium/ad/limit/usage snapshot. Flutter depends on this
 * exact shape:
 * {
 *   tier: 'free'|'premium',
 *   premiumExpiresAt: ISODate|null,
 *   premiumSource: string|null,
 *   adFree: boolean,
 *   limits: { messages: number|null, chats: number|null, webSearches: number|null },
 *   usage:  { date: 'YYYY-MM-DD', messages: number, chats: number, webSearches: number }
 * }
 * null limit = unlimited. The legacy `limits` and `usage` fields remain daily
 * scalars for deployed apps; weekly and total-resource information is additive.
 */
export const getEntitlements = catchAsync(async (req, res) => {
  const user = (await recomputeTier(req.auth.user._id)) || req.auth.user;
  const snapshot = entitlementSnapshot(user);
  const premium = isPremiumUser(user);

  const [messageLimits, chatLimits, webSearchLimits, checklistQuota] =
    await Promise.all([
      getUsageLimits(USAGE_KINDS.MESSAGES, premium),
      getUsageLimits(USAGE_KINDS.CHATS, premium),
      getUsageLimits(USAGE_KINDS.WEB_SEARCHES, premium),
      getCustomChecklistQuota(user)
    ]);
  const current = getCurrentUsageSnapshot(user);

  // V1: retain the exact scalar daily shape older Flutter releases parse.
  const limits = {
    messages: publicLimit(messageLimits.daily),
    chats: publicLimit(chatLimits.daily),
    webSearches: publicLimit(webSearchLimits.daily)
  };
  const usage = { ...current.daily };
  const weeklyLimits = {
    messages: publicLimit(messageLimits.weekly),
    chats: publicLimit(chatLimits.weekly),
    webSearches: publicLimit(webSearchLimits.weekly)
  };
  const weeklyUsage = { ...current.weekly };

  const limitsV2 = {
    messages: {
      daily: publicLimit(messageLimits.daily),
      weekly: publicLimit(messageLimits.weekly)
    },
    chats: {
      daily: publicLimit(chatLimits.daily),
      weekly: publicLimit(chatLimits.weekly)
    },
    webSearches: {
      daily: publicLimit(webSearchLimits.daily),
      weekly: publicLimit(webSearchLimits.weekly)
    },
    customChecklists: {
      total: publicLimit(checklistQuota.limit)
    }
  };
  const usageV2 = {
    timezone: 'UTC',
    daily: {
      ...current.daily,
      resetsAt: current.windows.dayResetAt
    },
    weekly: {
      ...current.weekly,
      resetsAt: current.windows.weekResetAt
    },
    totals: {
      customChecklists: checklistQuota.used
    }
  };

  sendSuccess(res, {
    message: 'Entitlements fetched successfully',
    data: {
      tier: snapshot.tier,
      premiumExpiresAt: snapshot.premiumExpiresAt,
      premiumSource: snapshot.premiumSource,
      adFree: snapshot.adFree,
      limits,
      usage,
      weeklyLimits,
      weeklyUsage,
      customChecklist: {
        limit: publicLimit(checklistQuota.limit),
        used: checklistQuota.used,
        remaining: checklistQuota.remaining
      },
      limitsV2,
      usageV2
    }
  });
});

/**
 * GET /api/v1/me/paywall-content
 * Returns the admin-editable Premium/paywall screen copy, resolved to the
 * caller's language with the {limit} placeholder filled from their daily
 * message limit. Always returns a full object (falls back to defaults).
 */
export const getPaywallContent = catchAsync(async (req, res) => {
  const user = req.auth.user;
  const language = resolveRequestLanguage(req, user.preferredLanguage);
  const premium = isPremiumUser(user);
  const messageLimit = premium ? null : await getSetting('freeDailyMessageLimit');
  const content = await getResolvedPaywallContent(language, messageLimit);

  sendSuccess(res, {
    message: 'Paywall content fetched successfully',
    data: content
  });
});
