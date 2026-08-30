import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUsageLimitError,
  evaluateUsageQuota,
  getCurrentUsageSnapshot,
  getUsageLimitSettingKeys,
  getUtcUsageWindows,
  USAGE_KINDS
} from '../services/usageLimit.service.js';
import {
  buildUserCreatedChecklistQuery,
  createChecklistLimitError,
  evaluateCustomChecklistQuota,
  getCustomChecklistLimitSettingKey
} from '../services/checklistQuota.service.js';
import {
  DEFAULT_SETTINGS,
  normalizeSettingValue
} from '../services/settings.service.js';

test('UTC usage windows start at midnight and Monday', () => {
  const sunday = getUtcUsageWindows('2026-08-30T23:59:59.000Z');
  assert.deepEqual(sunday, {
    dayKey: '2026-08-30',
    weekKey: '2026-08-24',
    dayResetAt: '2026-08-31T00:00:00.000Z',
    weekResetAt: '2026-08-31T00:00:00.000Z'
  });

  const monday = getUtcUsageWindows('2026-08-31T00:00:00.000Z');
  assert.equal(monday.dayKey, '2026-08-31');
  assert.equal(monday.weekKey, '2026-08-31');
  assert.equal(monday.weekResetAt, '2026-09-07T00:00:00.000Z');
});

test('stale daily counters and stale weekly counters independently report zero', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');
  const snapshot = getCurrentUsageSnapshot(
    {
      dailyUsage: {
        date: '2026-08-29',
        messages: 99,
        chats: 8,
        webSearches: 7
      },
      weeklyUsage: {
        weekStart: '2026-08-24',
        messages: 12,
        chats: 3,
        webSearches: 4
      }
    },
    now
  );

  assert.deepEqual(snapshot.daily, {
    date: '2026-08-30',
    messages: 0,
    chats: 0,
    webSearches: 0
  });
  assert.equal(snapshot.weekly.messages, 12);
  assert.equal(snapshot.weekly.webSearches, 4);
});

test('daily and weekly limits are evaluated independently with daily precedence', () => {
  const snapshot = {
    windows: {
      dayResetAt: 'day-reset',
      weekResetAt: 'week-reset'
    },
    daily: { messages: 5 },
    weekly: { messages: 20 }
  };
  const both = evaluateUsageQuota({
    kind: USAGE_KINDS.MESSAGES,
    snapshot,
    dailyLimit: 5,
    weeklyLimit: 20
  });
  assert.equal(both.allowed, false);
  assert.equal(both.blockedWindow, 'day');
  assert.equal(both.daily.remaining, 0);

  const weeklyOnly = evaluateUsageQuota({
    kind: USAGE_KINDS.MESSAGES,
    snapshot: {
      ...snapshot,
      daily: { messages: 1 }
    },
    dailyLimit: 5,
    weeklyLimit: 20
  });
  assert.equal(weeklyOnly.allowed, false);
  assert.equal(weeklyOnly.blockedWindow, 'week');
  assert.equal(weeklyOnly.weekly.resetAt, 'week-reset');
});

test('zero means unlimited while usage is still represented', () => {
  const quota = evaluateUsageQuota({
    kind: USAGE_KINDS.WEB_SEARCHES,
    snapshot: {
      windows: {},
      daily: { webSearches: 500 },
      weekly: { webSearches: 4000 }
    },
    dailyLimit: 0,
    weeklyLimit: 0
  });
  assert.equal(quota.allowed, true);
  assert.equal(quota.daily.used, 500);
  assert.equal(quota.daily.remaining, null);
  assert.equal(quota.weekly.remaining, null);
});

test('tier and feature map to the intended setting keys', () => {
  assert.deepEqual(
    getUsageLimitSettingKeys(USAGE_KINDS.MESSAGES, false),
    {
      daily: 'freeDailyMessageLimit',
      weekly: 'freeWeeklyMessageLimit'
    }
  );
  assert.deepEqual(
    getUsageLimitSettingKeys(USAGE_KINDS.MESSAGES, true),
    {
      daily: 'premiumDailyMessageLimit',
      weekly: 'premiumWeeklyMessageLimit'
    }
  );
  assert.deepEqual(
    getUsageLimitSettingKeys(USAGE_KINDS.WEB_SEARCHES, true),
    {
      daily: 'webSearchPremiumDailyLimit',
      weekly: 'webSearchPremiumWeeklyLimit'
    }
  );
  assert.deepEqual(getUsageLimitSettingKeys(USAGE_KINDS.CHATS, true), {
    daily: null,
    weekly: null
  });
});

test('daily and weekly errors retain the legacy code and structured plan data', () => {
  const base = {
    kind: USAGE_KINDS.MESSAGES,
    premium: true,
    tier: 'premium',
    daily: { limit: 3, used: 3, remaining: 0, resetAt: 'd' },
    weekly: { limit: 10, used: 10, remaining: 0, resetAt: 'w' }
  };

  const daily = createUsageLimitError({ ...base, blockedWindow: 'day' });
  assert.equal(daily.code, 'DAILY_LIMIT_REACHED');
  assert.equal(daily.details.window, 'day');
  assert.equal(daily.details.tier, 'premium');
  assert.equal(daily.details.upgradeAvailable, false);

  const weekly = createUsageLimitError({ ...base, blockedWindow: 'week' });
  assert.equal(weekly.code, 'WEEKLY_LIMIT_REACHED');
  assert.equal(weekly.details.limit, 10);
  assert.equal(weekly.details.resetsAt, 'w');
});

test('all requested settings exist, accept zero, and reject invalid limits', () => {
  const keys = [
    'freeWeeklyMessageLimit',
    'premiumDailyMessageLimit',
    'premiumWeeklyMessageLimit',
    'webSearchFreeWeeklyLimit',
    'webSearchPremiumWeeklyLimit',
    'freeCustomChecklistLimit',
    'premiumCustomChecklistLimit'
  ];

  for (const key of keys) {
    assert.equal(DEFAULT_SETTINGS[key], 0, `${key} should default to unlimited`);
    assert.equal(normalizeSettingValue(key, 0), 0);
    assert.equal(normalizeSettingValue(key, 12), 12);
    assert.throws(() => normalizeSettingValue(key, -1), /integer >= 0/);
    assert.throws(() => normalizeSettingValue(key, 1.5), /integer >= 0/);
  }
});

test('custom checklist quota excludes personalized template copies', () => {
  assert.deepEqual(buildUserCreatedChecklistQuery('user_1'), {
    ownerId: 'user_1',
    type: 'custom',
    $or: [
      { sourceChecklistId: null },
      { sourceChecklistId: { $exists: false } }
    ]
  });
  assert.equal(getCustomChecklistLimitSettingKey(false), 'freeCustomChecklistLimit');
  assert.equal(getCustomChecklistLimitSettingKey(true), 'premiumCustomChecklistLimit');

  const atLimit = evaluateCustomChecklistQuota({
    used: 3,
    limit: 3,
    premium: false
  });
  assert.equal(atLimit.allowed, false);
  assert.equal(atLimit.remaining, 0);
  const error = createChecklistLimitError(atLimit);
  assert.equal(error.code, 'CHECKLIST_LIMIT_REACHED');
  assert.equal(error.details.window, 'total');
  assert.equal(error.details.upgradeAvailable, true);

  assert.equal(
    evaluateCustomChecklistQuota({ used: 999, limit: 0, premium: true }).allowed,
    true
  );
});

