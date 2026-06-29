import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import {
  entitlementSnapshot,
  isPremiumUser,
  recomputeTier
} from '../services/premium.service.js';
import { getSetting } from '../services/settings.service.js';

const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

/**
 * GET /api/v1/me/entitlements
 * Returns the caller's premium/ad/limit/usage snapshot. Flutter depends on this
 * exact shape:
 * {
 *   tier: 'free'|'premium',
 *   premiumExpiresAt: ISODate|null,
 *   premiumSource: string|null,
 *   adFree: boolean,
 *   limits: { messages: number|null, chats: number|null },   // null = unlimited (premium)
 *   usage:  { date: 'YYYY-MM-DD', messages: number, chats: number }
 * }
 */
export const getEntitlements = catchAsync(async (req, res) => {
  const user = (await recomputeTier(req.auth.user._id)) || req.auth.user;
  const snapshot = entitlementSnapshot(user);
  const premium = isPremiumUser(user);

  // Premium users have no daily caps; report unlimited as null.
  let limits = { messages: null, chats: null };
  if (!premium) {
    const [messageLimit, chatLimit] = await Promise.all([
      getSetting('freeDailyMessageLimit'),
      getSetting('freeDailyChatLimit')
    ]);
    limits = { messages: messageLimit, chats: chatLimit };
  }

  // Roll over: if the stored usage date is not today (UTC), report zeros.
  const today = todayStr();
  const stored = user.dailyUsage;
  const usage =
    stored && stored.date === today
      ? {
          date: today,
          messages: stored.messages || 0,
          chats: stored.chats || 0
        }
      : { date: today, messages: 0, chats: 0 };

  sendSuccess(res, {
    message: 'Entitlements fetched successfully',
    data: {
      tier: snapshot.tier,
      premiumExpiresAt: snapshot.premiumExpiresAt,
      premiumSource: snapshot.premiumSource,
      adFree: snapshot.adFree,
      limits,
      usage
    }
  });
});
