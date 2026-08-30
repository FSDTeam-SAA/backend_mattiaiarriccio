import { StatusCodes } from 'http-status-codes';
import User from '../models/user.model.js';
import ApiError from '../utils/ApiError.js';
import { getSetting } from './settings.service.js';
import { isPremiumUser } from './premium.service.js';

export const USAGE_KINDS = Object.freeze({
  MESSAGES: 'messages',
  CHATS: 'chats',
  WEB_SEARCHES: 'webSearches'
});

const VALID_KINDS = new Set(Object.values(USAGE_KINDS));
const DAY_MS = 24 * 60 * 60 * 1000;

const assertUsageKind = (kind) => {
  if (!VALID_KINDS.has(kind)) {
    throw new TypeError(`Unknown usage kind: ${kind}`);
  }
};

const safeCounter = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const safeLimit = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const dateKey = (date) => date.toISOString().slice(0, 10);

/**
 * Fixed UTC quota windows. A week starts Monday 00:00 UTC and ends at the next
 * Monday. Returning reset timestamps lets clients explain the exact wait.
 */
export const getUtcUsageWindows = (input = new Date()) => {
  const now = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(now.getTime())) throw new TypeError('A valid date is required');

  const dayStartDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const daysSinceMonday = (dayStartDate.getUTCDay() + 6) % 7;
  const weekStartDate = new Date(dayStartDate.getTime() - daysSinceMonday * DAY_MS);

  return {
    dayKey: dateKey(dayStartDate),
    weekKey: dateKey(weekStartDate),
    dayResetAt: new Date(dayStartDate.getTime() + DAY_MS).toISOString(),
    weekResetAt: new Date(weekStartDate.getTime() + 7 * DAY_MS).toISOString()
  };
};

export const emptyDailyUsage = (dayKey = '') => ({
  date: dayKey,
  messages: 0,
  chats: 0,
  webSearches: 0
});

export const emptyWeeklyUsage = (weekKey = '') => ({
  weekStart: weekKey,
  messages: 0,
  chats: 0,
  webSearches: 0
});

/** Returns current-window counters without mutating the supplied user object. */
export const getCurrentUsageSnapshot = (user, input = new Date()) => {
  const windows = getUtcUsageWindows(input);
  const daily =
    user?.dailyUsage?.date === windows.dayKey
      ? {
          date: windows.dayKey,
          messages: safeCounter(user.dailyUsage.messages),
          chats: safeCounter(user.dailyUsage.chats),
          webSearches: safeCounter(user.dailyUsage.webSearches)
        }
      : emptyDailyUsage(windows.dayKey);
  const weekly =
    user?.weeklyUsage?.weekStart === windows.weekKey
      ? {
          weekStart: windows.weekKey,
          messages: safeCounter(user.weeklyUsage.messages),
          chats: safeCounter(user.weeklyUsage.chats),
          webSearches: safeCounter(user.weeklyUsage.webSearches)
        }
      : emptyWeeklyUsage(windows.weekKey);

  return { windows, daily, weekly };
};

/**
 * Settings used by each quota. `chats` means newly-created conversations, not
 * chatbot requests; it retains the legacy Free daily cap and is otherwise
 * unlimited while still being counted for both tiers.
 */
export const getUsageLimitSettingKeys = (kind, premium) => {
  assertUsageKind(kind);

  if (kind === USAGE_KINDS.MESSAGES) {
    return premium
      ? {
          daily: 'premiumDailyMessageLimit',
          weekly: 'premiumWeeklyMessageLimit'
        }
      : {
          daily: 'freeDailyMessageLimit',
          weekly: 'freeWeeklyMessageLimit'
        };
  }

  if (kind === USAGE_KINDS.WEB_SEARCHES) {
    return premium
      ? {
          daily: 'webSearchPremiumDailyLimit',
          weekly: 'webSearchPremiumWeeklyLimit'
        }
      : {
          daily: 'webSearchFreeDailyLimit',
          weekly: 'webSearchFreeWeeklyLimit'
        };
  }

  return premium
    ? { daily: null, weekly: null }
    : { daily: 'freeDailyChatLimit', weekly: null };
};

export const getUsageLimits = async (kind, premium) => {
  const keys = getUsageLimitSettingKeys(kind, premium);
  const [daily, weekly] = await Promise.all([
    keys.daily ? getSetting(keys.daily) : 0,
    keys.weekly ? getSetting(keys.weekly) : 0
  ]);
  return {
    daily: safeLimit(daily),
    weekly: safeLimit(weekly)
  };
};

const remaining = (limit, used) =>
  limit === 0 ? null : Math.max(0, limit - used);

/** Pure quota decision helper, intentionally testable without MongoDB. */
export const evaluateUsageQuota = ({
  kind,
  snapshot,
  dailyLimit = 0,
  weeklyLimit = 0
}) => {
  assertUsageKind(kind);
  const normalizedDailyLimit = safeLimit(dailyLimit);
  const normalizedWeeklyLimit = safeLimit(weeklyLimit);
  const dailyUsed = safeCounter(snapshot?.daily?.[kind]);
  const weeklyUsed = safeCounter(snapshot?.weekly?.[kind]);
  const dailyBlocked =
    normalizedDailyLimit > 0 && dailyUsed >= normalizedDailyLimit;
  const weeklyBlocked =
    normalizedWeeklyLimit > 0 && weeklyUsed >= normalizedWeeklyLimit;
  const blockedWindow = dailyBlocked ? 'day' : weeklyBlocked ? 'week' : null;

  return {
    allowed: blockedWindow === null,
    blockedWindow,
    daily: {
      limit: normalizedDailyLimit,
      used: dailyUsed,
      remaining: remaining(normalizedDailyLimit, dailyUsed),
      resetAt: snapshot?.windows?.dayResetAt ?? null
    },
    weekly: {
      limit: normalizedWeeklyLimit,
      used: weeklyUsed,
      remaining: remaining(normalizedWeeklyLimit, weeklyUsed),
      resetAt: snapshot?.windows?.weekResetAt ?? null
    }
  };
};

export const getUserUsageQuota = async ({ user, kind, now = new Date() }) => {
  assertUsageKind(kind);
  const premium = isPremiumUser(user);
  const limits = await getUsageLimits(kind, premium);
  const snapshot = getCurrentUsageSnapshot(user, now);
  return {
    ...evaluateUsageQuota({
      kind,
      snapshot,
      dailyLimit: limits.daily,
      weeklyLimit: limits.weekly
    }),
    kind,
    premium,
    tier: premium ? 'premium' : 'free',
    consumed: false,
    snapshot
  };
};

/**
 * Resets stale buckets and atomically increments both current counters subject
 * to both caps. The conditional findOneAndUpdate is the concurrency boundary:
 * parallel requests cannot each increment past a finite daily/weekly limit.
 */
export const consumeUserUsage = async ({ user, kind, now = new Date() }) => {
  assertUsageKind(kind);
  if (!user?._id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication required');
  }

  const premium = isPremiumUser(user);
  const limits = await getUsageLimits(kind, premium);
  const windows = getUtcUsageWindows(now);

  // An aggregation update makes rollover idempotent under concurrency. A later
  // reset sees the current key and preserves counters already incremented by an
  // earlier request instead of replacing the whole subdocument with zeroes.
  await User.updateOne(
    { _id: user._id },
    [
      {
        $set: {
          dailyUsage: {
            $cond: [
              { $eq: ['$dailyUsage.date', windows.dayKey] },
              {
                date: windows.dayKey,
                messages: { $ifNull: ['$dailyUsage.messages', 0] },
                chats: { $ifNull: ['$dailyUsage.chats', 0] },
                webSearches: { $ifNull: ['$dailyUsage.webSearches', 0] }
              },
              emptyDailyUsage(windows.dayKey)
            ]
          },
          weeklyUsage: {
            $cond: [
              { $eq: ['$weeklyUsage.weekStart', windows.weekKey] },
              {
                weekStart: windows.weekKey,
                messages: { $ifNull: ['$weeklyUsage.messages', 0] },
                chats: { $ifNull: ['$weeklyUsage.chats', 0] },
                webSearches: { $ifNull: ['$weeklyUsage.webSearches', 0] }
              },
              emptyWeeklyUsage(windows.weekKey)
            ]
          }
        }
      }
    ]
  );

  const filter = {
    _id: user._id,
    'dailyUsage.date': windows.dayKey,
    'weeklyUsage.weekStart': windows.weekKey
  };
  if (limits.daily > 0) {
    filter[`dailyUsage.${kind}`] = { $lt: limits.daily };
  }
  if (limits.weekly > 0) {
    filter[`weeklyUsage.${kind}`] = { $lt: limits.weekly };
  }

  const updated = await User.findOneAndUpdate(
    filter,
    {
      $inc: {
        [`dailyUsage.${kind}`]: 1,
        [`weeklyUsage.${kind}`]: 1
      }
    },
    { new: true }
  ).lean();

  if (updated) {
    const snapshot = getCurrentUsageSnapshot(updated, now);
    const nextDecision = evaluateUsageQuota({
      kind,
      snapshot,
      dailyLimit: limits.daily,
      weeklyLimit: limits.weekly
    });
    return {
      ...nextDecision,
      // The increment succeeded, so this request is allowed even if it consumed
      // the final slot and the next request is now blocked.
      allowed: true,
      blockedWindow: null,
      nextBlockedWindow: nextDecision.blockedWindow,
      kind,
      premium,
      tier: premium ? 'premium' : 'free',
      consumed: true,
      snapshot,
      user: updated
    };
  }

  const currentUser = await User.findById(user._id).lean();
  if (!currentUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User no longer exists');
  }
  const snapshot = getCurrentUsageSnapshot(currentUser, now);
  return {
    ...evaluateUsageQuota({
      kind,
      snapshot,
      dailyLimit: limits.daily,
      weeklyLimit: limits.weekly
    }),
    kind,
    premium,
    tier: premium ? 'premium' : 'free',
    consumed: false,
    snapshot,
    user: currentUser
  };
};

/** Best-effort rollback for a reserved operation that did not actually run. */
export const refundUserUsage = async ({
  userId,
  kind,
  now = new Date()
}) => {
  assertUsageKind(kind);
  if (!userId) return;
  const windows = getUtcUsageWindows(now);

  await Promise.all([
    User.updateOne(
      {
        _id: userId,
        'dailyUsage.date': windows.dayKey,
        [`dailyUsage.${kind}`]: { $gt: 0 }
      },
      { $inc: { [`dailyUsage.${kind}`]: -1 } }
    ),
    User.updateOne(
      {
        _id: userId,
        'weeklyUsage.weekStart': windows.weekKey,
        [`weeklyUsage.${kind}`]: { $gt: 0 }
      },
      { $inc: { [`weeklyUsage.${kind}`]: -1 } }
    )
  ]);
};

export const applyUsageSnapshotToAuthUser = (authUser, quota) => {
  if (!authUser || !quota?.snapshot) return;
  authUser.dailyUsage = { ...quota.snapshot.daily };
  authUser.weeklyUsage = { ...quota.snapshot.weekly };
};

const quotaLabel = (kind) => {
  if (kind === USAGE_KINDS.MESSAGES) return 'message';
  if (kind === USAGE_KINDS.CHATS) return 'new conversation';
  return 'Web Search';
};

export const createUsageLimitError = (quota) => {
  const window = quota?.blockedWindow === 'week' ? 'week' : 'day';
  const selected = window === 'week' ? quota?.weekly : quota?.daily;
  const tier = quota?.premium ? 'Premium' : 'Free';
  const label = quotaLabel(quota?.kind);
  const err = new ApiError(
    StatusCodes.TOO_MANY_REQUESTS,
    `${tier} plan ${window === 'week' ? 'weekly' : 'daily'} ${label} limit reached.`
  );
  err.code = window === 'week' ? 'WEEKLY_LIMIT_REACHED' : 'DAILY_LIMIT_REACHED';
  err.details = {
    // `kind`, `limit`, and `used` preserve the existing mobile error contract.
    kind: quota?.kind,
    feature: quota?.kind,
    window,
    tier: quota?.tier || (quota?.premium ? 'premium' : 'free'),
    limit: selected?.limit ?? 0,
    used: selected?.used ?? 0,
    remaining: selected?.remaining ?? 0,
    resetsAt: selected?.resetAt ?? null,
    upgradeAvailable: !quota?.premium,
    daily: quota?.daily,
    weekly: quota?.weekly
  };
  return err;
};

