import { StatusCodes } from 'http-status-codes';
import User from '../models/user.model.js';
import Subscription from '../models/subscription.model.js';
import ApiError from '../utils/ApiError.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recomputes and persists a user's resolved tier from BOTH sources:
 *  - any active store Subscription (status active/in_grace, not expired), and
 *  - the manual/coupon grant stored on the user (manualPremium* fields).
 * Lifetime manual grant = manualPremiumActive && manualPremiumExpiresAt === null.
 */
export const recomputeTier = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return null;

  const now = new Date();

  const activeSub = await Subscription.findOne({
    userId,
    status: { $in: ['active', 'in_grace'] },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  })
    .sort({ expiresAt: -1 })
    .lean();

  const subActive = Boolean(activeSub);
  const subExpiry = activeSub?.expiresAt ?? null;
  const subSource = activeSub?.store ?? null; // 'google_play' | 'app_store'

  const manualActive =
    Boolean(user.manualPremiumActive) &&
    (user.manualPremiumExpiresAt === null ||
      user.manualPremiumExpiresAt === undefined ||
      new Date(user.manualPremiumExpiresAt) > now);
  const manualLifetime = manualActive && !user.manualPremiumExpiresAt;

  const isPremium = subActive || manualActive;

  let premiumExpiresAt = null;
  let premiumSource = null;

  if (isPremium) {
    if (manualLifetime) {
      premiumExpiresAt = null; // lifetime wins
      premiumSource = user.manualPremiumSource || 'manual';
    } else {
      const candidates = [];
      if (subActive) candidates.push({ expiresAt: subExpiry, source: subSource });
      if (manualActive) {
        candidates.push({
          expiresAt: user.manualPremiumExpiresAt,
          source: user.manualPremiumSource || 'manual'
        });
      }
      candidates.sort((a, b) => {
        const av = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const bv = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        return bv - av;
      });
      premiumExpiresAt = candidates[0].expiresAt ?? null;
      premiumSource = candidates[0].source;
    }
  }

  user.tier = isPremium ? 'premium' : 'free';
  user.premiumSource = isPremium ? premiumSource : null;
  user.premiumExpiresAt = premiumExpiresAt;
  await user.save();

  return user;
};

/**
 * Called after a verified subscription is upserted. The Subscription row is the
 * source of truth, so we simply recompute.
 */
export const applySubscription = async (userId /* , subscription */) =>
  recomputeTier(userId);

/**
 * Grants a manual/coupon premium period.
 * @param {string} userId
 * @param {{ durationDays?: number|null, source?: 'manual'|'coupon', adminId?: string|null }} opts
 *   durationDays null = lifetime.
 */
export const grantManual = async (
  userId,
  { durationDays = null, source = 'manual', adminId = null } = {}
) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  user.manualPremiumActive = true;
  user.manualPremiumExpiresAt =
    durationDays === null || durationDays === undefined
      ? null
      : new Date(Date.now() + Number(durationDays) * DAY_MS);
  user.manualPremiumSource = source === 'coupon' ? 'coupon' : 'manual';
  user.premiumGrantedBy = adminId;
  await user.save();

  return recomputeTier(userId);
};

/**
 * Clears any manual/coupon grant. Store subscriptions still count after recompute.
 */
export const revoke = async (userId, adminId = null) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  user.manualPremiumActive = false;
  user.manualPremiumExpiresAt = null;
  user.manualPremiumSource = null;
  user.premiumGrantedBy = adminId;
  await user.save();

  return recomputeTier(userId);
};

/**
 * Cheap, DB-free premium check usable inside hot paths/middleware. Trusts the
 * persisted tier but defensively honours an elapsed premiumExpiresAt.
 */
export const isPremiumUser = (user) => {
  if (!user || user.tier !== 'premium') return false;
  if (user.premiumExpiresAt && new Date(user.premiumExpiresAt) <= new Date()) {
    return false;
  }
  return true;
};

export const isAdFree = (user) => isPremiumUser(user);

/**
 * The entitlement snapshot returned to clients (limits/usage are added by the
 * caller from Settings since they are not premium-engine concerns).
 */
export const entitlementSnapshot = (user) => ({
  tier: isPremiumUser(user) ? 'premium' : 'free',
  premiumSource: isPremiumUser(user) ? user.premiumSource ?? null : null,
  premiumExpiresAt: isPremiumUser(user) ? user.premiumExpiresAt ?? null : null,
  adFree: isAdFree(user)
});
