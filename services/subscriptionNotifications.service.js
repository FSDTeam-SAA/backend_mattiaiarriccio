/**
 * Premium subscription lifecycle notifications.
 *
 * Reuses the existing NotificationJob queue + dispatcher (retry, per-user
 * channel/email preferences, localization) instead of sending inline. Callers
 * enqueue jobs; the scheduler's dispatchDueJobs delivers them.
 *
 *  - Transactional events (activated/renewed/expired/canceled/payment_failed)
 *    are enqueued with scheduledAt = now for near-immediate delivery.
 *  - Expiry reminders are enqueued ahead of time by syncPremiumExpiryReminders()
 *    (a daily Agenda job), at 7/3/1/0 days before premiumExpiresAt.
 */

import NotificationJob from '../models/notificationJob.model.js';
import User from '../models/user.model.js';
import { createId } from '../lib/id.js';
import { renderNotificationContent } from './notificationContent.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_CHANNELS = ['push', 'email'];
const EXPIRY_OFFSET_DAYS = [7, 3, 1, 0];
// Only materialize a reminder job once its fire time is within this window, so a
// daily scan tops up near-term reminders rather than piling far-future jobs.
const REMINDER_LOOKAHEAD_MS = 2 * MS_PER_DAY;

const formatDay = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * Enqueue a premium job per channel. `dedupeRefId` (when provided) prevents the
 * same reminder being created twice across repeated scans — regardless of the
 * existing job's status, so an already-sent reminder is never recreated.
 */
const enqueuePremiumJob = async ({
  userId,
  contentKey,
  params = {},
  type = 'premium',
  scheduledAt = new Date(),
  channels = DEFAULT_CHANNELS,
  dedupeRefId = null,
  inApp = true,
  maxAttempts = null
}) => {
  if (!userId || !contentKey) return [];

  // English fallback stored on the job; the dispatcher localizes via contentKey.
  const fallback = renderNotificationContent(contentKey, params, 'en') || {
    title: 'WeSafe',
    body: ''
  };

  const created = [];
  for (const channel of channels) {
    if (dedupeRefId) {
      const exists = await NotificationJob.findOne({
        userId,
        refId: dedupeRefId,
        channel,
        contentKey
      })
        .select('_id')
        .lean();
      if (exists) continue;
    }

    const job = await NotificationJob.create({
      _id: createId('notifjob'),
      userId,
      type,
      refId: dedupeRefId,
      title: fallback.title,
      body: fallback.body,
      contentKey,
      contentParams: params,
      scheduledAt,
      channel,
      status: 'pending',
      inApp,
      ...(maxAttempts ? { maxAttempts } : {})
    });
    created.push(job._id);
  }
  return created;
};

// A stable dedupe key so the same premium event never notifies twice — across
// webhook replays and repeated verify calls. Keyed by user + event + the expiry
// that identifies this specific renewal/expiry instance.
const premiumRefId = (event, userId, expiresAt) =>
  `prem:${event}:${userId}:${expiresAt ? formatDay(expiresAt) : 'na'}`;

export const notifyPremiumActivated = (userId, expiresAt = null) =>
  enqueuePremiumJob({
    userId,
    contentKey: 'premium_activated',
    type: 'premium',
    dedupeRefId: premiumRefId('activated', userId, expiresAt)
  });

/**
 * Reliable PUSH-ONLY activation retry. Used by admin premium grants when the
 * immediate push could not be delivered (e.g. the user's device token was not
 * registered yet). Delivers via the dispatcher (retry + backoff) and does NOT
 * create a second in-app record — the grant already created one.
 */
export const enqueuePremiumActivationPush = (userId, expiresAt = null) =>
  enqueuePremiumJob({
    userId,
    contentKey: 'premium_activated',
    type: 'premium',
    channels: ['push'],
    inApp: false,
    // More attempts than the default so the push keeps retrying until the user's
    // device token registers (i.e. they next open the app).
    maxAttempts: 10,
    dedupeRefId: premiumRefId('activated_push', userId, expiresAt)
  });

export const notifyPremiumRenewed = (userId, expiresAt = null) =>
  enqueuePremiumJob({
    userId,
    contentKey: 'premium_renewed',
    type: 'premium',
    dedupeRefId: premiumRefId('renewed', userId, expiresAt)
  });

export const notifyPremiumExpired = (userId, expiresAt = null) =>
  enqueuePremiumJob({
    userId,
    contentKey: 'premium_expired',
    type: 'premium',
    dedupeRefId: premiumRefId('expired', userId, expiresAt)
  });

export const notifyPremiumCanceled = (userId, endDate = null) =>
  enqueuePremiumJob({
    userId,
    contentKey: 'premium_canceled',
    params: { date: endDate ? formatDay(endDate) : '' },
    type: 'premium',
    dedupeRefId: premiumRefId('canceled', userId, endDate)
  });

export const notifyPremiumPaymentFailed = (userId, expiresAt = null) =>
  enqueuePremiumJob({
    userId,
    contentKey: 'premium_payment_failed',
    type: 'premium',
    dedupeRefId: premiumRefId('payment_failed', userId, expiresAt)
  });

/**
 * Daily scan: schedule premium-expiry reminders for users whose Premium is about
 * to lapse. Idempotent via a per-(user, expiry-date, offset) dedupe refId.
 */
export const syncPremiumExpiryReminders = async () => {
  const now = new Date();
  const horizon = new Date(now.getTime() + (Math.max(...EXPIRY_OFFSET_DAYS) + 2) * MS_PER_DAY);

  const users = await User.find({
    tier: 'premium',
    premiumExpiresAt: { $ne: null, $gt: now, $lte: horizon }
  })
    .select('_id premiumExpiresAt')
    .lean();

  let enqueued = 0;
  const windowEnd = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS);

  for (const user of users) {
    const expiry = new Date(user.premiumExpiresAt);
    const expiryKey = formatDay(expiry);

    for (const offset of EXPIRY_OFFSET_DAYS) {
      const fireAt = new Date(expiry.getTime() - offset * MS_PER_DAY);
      // Skip past reminders and ones still further out than the lookahead window.
      if (fireAt <= now || fireAt > windowEnd) continue;

      const refId = `premexp:${user._id}:${expiryKey}:${offset}`;
      const created = await enqueuePremiumJob({
        userId: user._id,
        contentKey: 'premium_expiring',
        params: { days: offset },
        type: 'premium_expiry',
        scheduledAt: fireAt,
        dedupeRefId: refId
      });
      enqueued += created.length;
    }
  }

  return { users: users.length, enqueued };
};
