import NotificationJob from '../models/notificationJob.model.js';
import User from '../models/user.model.js';
import { createId } from '../lib/id.js';
import { getSetting } from './settings.service.js';
import { notifyUser } from './notify.service.js';
import { sendToUser } from './push.service.js';
import { sendReminderEmail } from './email.service.js';
import {
  effectiveNotificationEmail,
  emailEnabledForType,
  pushEnabledForType,
  NOTIFICATION_PREF_FIELDS
} from '../utils/notificationPrefs.js';
import { renderNotificationContent } from './notificationContent.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const subtractDays = (date, days) => {
  const base = date instanceof Date ? date : new Date(date);
  return new Date(base.getTime() - Number(days || 0) * MS_PER_DAY);
};

const isFutureOrNow = (date) => date instanceof Date && date.getTime() > Date.now();

const formatDay = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * Rebuild all pending NotificationJobs for a material from its current
 * reminderRules + inspection schedule.
 *
 * Strategy: delete the material's still-pending jobs (sent/failed/canceled are
 * left untouched as history), then recreate the future-dated ones. Any job whose
 * scheduledAt is in the past is skipped (we never backfill expired reminders).
 */
export const syncForMaterial = async (material) => {
  if (!material || !material._id) {
    return [];
  }

  // Remove only the pending jobs so we never disturb already-sent history.
  await NotificationJob.deleteMany({
    refId: material._id,
    status: 'pending'
  });

  if (material.active === false) {
    return [];
  }

  const jobs = [];

  // Expiry reminders: scheduledAt = expirationDate - offsetDays.
  if (material.expirationDate) {
    const rules = Array.isArray(material.reminderRules) ? material.reminderRules : [];
    for (const rule of rules) {
      const offsetDays = Number(rule?.offsetDays || 0);
      const channel = rule?.channel === 'push' ? 'push' : 'local';
      const scheduledAt = subtractDays(material.expirationDate, offsetDays);

      if (!isFutureOrNow(scheduledAt)) {
        continue;
      }

      const expiryDate = new Date(material.expirationDate).toISOString().slice(0, 10);
      jobs.push({
        _id: createId('notifjob'),
        userId: material.userId,
        type: 'material_expiry',
        refId: material._id,
        title: 'Material expiring soon',
        body: `${material.name} expires on ${expiryDate}.`,
        contentKey: 'material_expiry',
        contentParams: { name: material.name, date: expiryDate },
        scheduledAt,
        channel,
        status: 'pending'
      });
    }
  }

  // Inspection reminder: one job at inspection.nextInspectionAt.
  const nextInspectionAt = material.inspection?.nextInspectionAt;
  if (nextInspectionAt && isFutureOrNow(new Date(nextInspectionAt))) {
    // Inspection reminders default to the configured channel; fall back to local.
    let inspectionChannel = 'local';
    try {
      const reminderDefaults = await getSetting('reminderDefaults');
      if (reminderDefaults?.channel === 'push') {
        inspectionChannel = 'push';
      }
    } catch {
      inspectionChannel = 'local';
    }

    jobs.push({
      _id: createId('notifjob'),
      userId: material.userId,
      type: 'inspection',
      refId: material._id,
      title: 'Inspection due',
      body: `It's time to inspect ${material.name}.`,
      contentKey: 'material_inspection',
      contentParams: { name: material.name },
      scheduledAt: new Date(nextInspectionAt),
      channel: inspectionChannel,
      status: 'pending'
    });
  }

  if (jobs.length === 0) {
    return [];
  }

  return NotificationJob.insertMany(jobs);
};

/**
 * Cancel (delete) all pending NotificationJobs tied to a material. Used when a
 * material is deleted.
 */
export const cancelForMaterial = async (materialId) => {
  if (!materialId) {
    return { deletedCount: 0 };
  }

  const result = await NotificationJob.deleteMany({
    refId: materialId,
    status: 'pending'
  });

  return { deletedCount: result.deletedCount || 0 };
};

// ---------------------------------------------------------------------------
// Checklist item reminders
// ---------------------------------------------------------------------------
//
// A checklist item carries: { reminderEnabled, reminderDaysBefore,
// expirationDate, notificationPreferences:{ push, email }, completed }.
// We schedule one job per enabled channel, fired `reminderDaysBefore` days
// before the item's expiration date. Completed items never get reminders.
// Jobs are keyed by refId = item._id so a re-sync cleanly replaces them.

const checklistItemReminderJobs = ({ userId, checklistId, item, completed }) => {
  const jobs = [];

  if (completed) return jobs;
  if (!item || item.reminderEnabled !== true) return jobs;
  if (!item.expirationDate) return jobs;

  const offsetDays = Number.isFinite(Number(item.reminderDaysBefore))
    ? Math.max(0, Math.round(Number(item.reminderDaysBefore)))
    : 0;
  const scheduledAt = subtractDays(item.expirationDate, offsetDays);
  if (!isFutureOrNow(scheduledAt)) return jobs;

  const prefs = item.notificationPreferences || {};
  const channels = [];
  if (prefs.push) channels.push('push');
  if (prefs.email) channels.push('email');
  // Honor the user's channel choices exactly: push off => no push job, email
  // off => no email job. With neither channel selected there is nothing to
  // deliver, so no job is scheduled. The app keeps at least one channel on
  // while a reminder is enabled, so this only no-ops on a deliberate opt-out.
  if (channels.length === 0) return jobs;

  // English fallback (also what admin history renders); the dispatcher localizes
  // via contentKey/contentParams to the recipient's language at send time.
  const dueDate = formatDay(item.expirationDate);
  const title = 'Checklist reminder';
  const body = `"${item.text}" is due on ${dueDate}.`;

  for (const channel of channels) {
    jobs.push({
      _id: createId('notifjob'),
      userId,
      type: 'checklist_item',
      refId: item._id,
      title,
      body,
      contentKey: 'checklist_item_reminder',
      contentParams: { item: item.text, date: dueDate },
      scheduledAt,
      channel,
      status: 'pending'
    });
  }

  return jobs;
};

/**
 * Rebuild pending reminder jobs for a single checklist item. Deletes the
 * item's still-pending jobs, then recreates them from its current state.
 */
export const syncForChecklistItem = async ({ userId, checklistId, item, completed = false }) => {
  if (!userId || !item?._id) return [];

  await NotificationJob.deleteMany({
    userId,
    refId: item._id,
    type: 'checklist_item',
    status: 'pending'
  });

  const jobs = checklistItemReminderJobs({ userId, checklistId, item, completed });
  if (jobs.length === 0) return [];
  return NotificationJob.insertMany(jobs);
};

/**
 * Re-sync reminders for every item in a checklist. `completedItemIds` is the
 * set of item ids the user has already ticked off (no reminder for those).
 */
export const syncForChecklist = async ({ userId, checklist, completedItemIds = [] }) => {
  if (!userId || !checklist?._id) return [];
  const completedSet = new Set(completedItemIds);
  const items = Array.isArray(checklist.items) ? checklist.items : [];

  await cancelForChecklistItems(userId, items.map((it) => it._id));

  const jobs = [];
  for (const item of items) {
    jobs.push(
      ...checklistItemReminderJobs({
        userId,
        checklistId: checklist._id,
        item,
        completed: completedSet.has(item._id)
      })
    );
  }

  if (jobs.length === 0) return [];
  return NotificationJob.insertMany(jobs);
};

/** Delete pending checklist-item jobs for the given item ids. */
export const cancelForChecklistItems = async (userId, itemIds = []) => {
  const ids = (itemIds || []).filter(Boolean);
  if (!userId || ids.length === 0) return { deletedCount: 0 };

  const result = await NotificationJob.deleteMany({
    userId,
    refId: { $in: ids },
    type: 'checklist_item',
    status: 'pending'
  });

  return { deletedCount: result.deletedCount || 0 };
};

// Default retry policy for transient push/email failures. Backoff is indexed by
// attempt number (attempt 1 waits 2 min, attempt 2 waits 10 min, ...). A job is
// marked 'failed' only after maxAttempts transient failures.
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000];

// Resolve a job's display copy in the recipient's language. Falls back to the
// job's stored (English) title/body when it carries no content key.
const localizedContentFor = (job, language) => {
  if (job.contentKey) {
    const rendered = renderNotificationContent(
      job.contentKey,
      job.contentParams || {},
      language === 'it' ? 'it' : 'en'
    );
    if (rendered) return rendered;
  }
  return { title: job.title, body: job.body };
};

// Deep-link target per notification type, consumed by the Flutter router.
const screenForType = (type) => {
  switch (type) {
    case 'material_expiry':
    case 'inspection':
      return 'material';
    case 'checklist_item':
      return 'checklist';
    case 'custom':
    case 'premium':
    case 'premium_expiry':
      return 'notifications';
    default:
      return 'home';
  }
};

/**
 * A transient delivery failure: reschedule the job for a later attempt, or mark
 * it 'failed' once attempts are exhausted. The optimistic claim already set
 * status 'sent', so we reset it here.
 */
const scheduleRetryOrFail = async (claimed, errorMessage) => {
  const attempts = (claimed.attempts || 0) + 1;
  const maxAttempts = claimed.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const message = String(errorMessage || 'delivery failed').slice(0, 500);

  if (attempts < maxAttempts) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
    const retryAt = new Date(Date.now() + backoff);
    await NotificationJob.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: 'pending',
          scheduledAt: retryAt,
          retryAt,
          sentAt: null,
          attempts,
          lastError: message,
          error: message
        }
      }
    );
    return 'retry';
  }

  await NotificationJob.updateOne(
    { _id: claimed._id },
    {
      $set: {
        status: 'failed',
        sentAt: null,
        attempts,
        lastError: message,
        error: message
      }
    }
  );
  return 'failed';
};

/**
 * Record a job that was intentionally not delivered (opt-out, no token, channel
 * unconfigured). Distinct from 'sent' so statistics stay accurate.
 */
const markSkipped = async (claimed, note) => {
  await NotificationJob.updateOne(
    { _id: claimed._id },
    { $set: { status: 'skipped', sentAt: null, error: String(note || '').slice(0, 500) } }
  );
};

/**
 * Deliver every due pending job. Called by the scheduler every couple of minutes.
 * - Skips entirely when the global notificationsEnabled setting is false.
 * - For each due job, atomically flips pending -> sent BEFORE dispatch using a
 *   status:'pending' guard so two overlapping ticks can never double-send.
 * - channel 'push' -> notifyUser (in-app record + FCM); 'email' -> sendReminderEmail;
 *   'local' -> mark sent (the Flutter client schedules its own local notification).
 * - Per-user delivery honours notificationEmail + receive*Notifications prefs.
 * - Transient push/email errors are retried with backoff (see scheduleRetryOrFail);
 *   the loop never throws.
 */
export const dispatchDueJobs = async () => {
  let notificationsEnabled = true;
  try {
    notificationsEnabled = await getSetting('notificationsEnabled');
  } catch {
    notificationsEnabled = true;
  }

  if (notificationsEnabled === false) {
    return { processed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, disabled: true };
  }

  const now = new Date();
  const dueJobs = await NotificationJob.find({
    status: 'pending',
    scheduledAt: { $lte: now }
  })
    .sort({ scheduledAt: 1 })
    .limit(200)
    .lean();

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;
  let processed = 0;

  for (const job of dueJobs) {
    // Atomic claim: only the worker that flips pending -> sent owns this job.
    const claimed = await NotificationJob.findOneAndUpdate(
      { _id: job._id, status: 'pending' },
      { $set: { status: 'sent', sentAt: new Date() } },
      { new: true }
    ).lean();

    if (!claimed) {
      // Another tick already claimed it.
      continue;
    }

    processed += 1;

    try {
      if (claimed.channel === 'push') {
        const user = await User.findById(claimed.userId)
          .select(`${NOTIFICATION_PREF_FIELDS} preferredLanguage`)
          .lean();
        const screen = screenForType(claimed.type);
        const { title, body } = localizedContentFor(claimed, user?.preferredLanguage);
        const pushAllowed = pushEnabledForType(user, claimed.type);
        const data = { type: claimed.type, refId: claimed.refId || '', screen };
        // inApp:false -> push only (the in-app record was created elsewhere);
        // otherwise notifyUser persists the record and sends push. Either way the
        // device push is gated by the user's push preference.
        let result;
        if (claimed.inApp === false) {
          result = pushAllowed
            ? await sendToUser(claimed.userId, {
                title,
                body,
                data,
                ttlMs: 12 * 60 * 60 * 1000
              })
            : { skipped: true, reason: 'push_disabled' };
        } else {
          // Email mirrors push via notifyUser, EXCEPT for job families that
          // already enqueue their own dedicated email job (checklist items,
          // premium lifecycle, admin campaigns) — those must not be emailed
          // twice. Material reminders are push-only, so they mirror email here.
          const managesEmailSeparately =
            claimed.type === 'checklist_item' ||
            claimed.type === 'premium' ||
            claimed.type === 'premium_expiry' ||
            Boolean(claimed.campaignId);
          result = await notifyUser(claimed.userId, {
            title,
            body,
            type: claimed.type,
            data,
            ttlMs: 12 * 60 * 60 * 1000,
            sendPush: pushAllowed,
            sendEmail: !managesEmailSeparately
          });
        }
        // A transient FCM error is retryable. For a push-only backup job
        // (inApp:false) a missing device token is also retryable — it just means
        // the user hasn't registered a token yet (app not opened); keep trying so
        // the push lands once they do. All other skips are recorded (not sent).
        const retryableSkip =
          result?.reason === 'error' ||
          (claimed.inApp === false && result?.reason === 'no_tokens');
        if (result?.skipped && retryableSkip) {
          const outcome = await scheduleRetryOrFail(
            claimed,
            `push ${result.reason}: ${result.error || result.reason || 'unknown'}`
          );
          outcome === 'failed' ? (failed += 1) : (retried += 1);
          continue;
        }
        if (result?.skipped) {
          await markSkipped(claimed, `push skipped: ${result.reason || 'unknown'}`);
          skipped += 1;
          continue;
        }
      } else if (claimed.channel === 'email') {
        const user = await User.findById(claimed.userId)
          .select(
            `email fullName notificationEmail ${NOTIFICATION_PREF_FIELDS} preferredLanguage`
          )
          .lean();

        // Respect a per-user / per-category opt-out without failing the job.
        if (!emailEnabledForType(user, claimed.type)) {
          await markSkipped(claimed, 'email skipped: user opted out');
          skipped += 1;
          continue;
        }

        const { title, body } = localizedContentFor(claimed, user?.preferredLanguage);
        const result = await sendReminderEmail({
          toEmail: effectiveNotificationEmail(user),
          toName: user?.fullName,
          title,
          body
        });
        // A transient SMTP error is retryable; config/recipient skips are recorded.
        if (result?.skipped && result.reason === 'error') {
          const outcome = await scheduleRetryOrFail(
            claimed,
            `email error: ${result.error || 'unknown'}`
          );
          outcome === 'failed' ? (failed += 1) : (retried += 1);
          continue;
        }
        if (result?.skipped) {
          await markSkipped(claimed, `email skipped: ${result.reason || 'unknown'}`);
          skipped += 1;
          continue;
        }
      }
      // Delivered (push/email) or a 'local' job (client-scheduled): count as sent.
      sent += 1;
    } catch (error) {
      const outcome = await scheduleRetryOrFail(claimed, error?.message || error);
      outcome === 'failed' ? (failed += 1) : (retried += 1);
    }
  }

  return { processed, sent, failed, retried, skipped };
};

/**
 * Delete terminal jobs (sent/failed/canceled) older than `days` days so the
 * notification_jobs collection does not grow unbounded. Pending jobs are never
 * removed. Returns the number deleted.
 */
export const cleanupOldJobs = async (days = 30) => {
  const cutoff = new Date(Date.now() - Math.max(1, days) * MS_PER_DAY);
  const result = await NotificationJob.deleteMany({
    status: { $in: ['sent', 'skipped', 'failed', 'canceled'] },
    createdAt: { $lt: cutoff }
  });
  return { deletedCount: result.deletedCount || 0 };
};

/**
 * Reset a job for immediate re-delivery (admin "retry"). Clears the terminal
 * state and attempt counter so the next dispatch tick picks it up.
 */
export const requeueJob = async (jobId) => {
  if (!jobId) return null;
  const now = new Date();
  return NotificationJob.findByIdAndUpdate(
    jobId,
    {
      $set: {
        status: 'pending',
        scheduledAt: now,
        retryAt: now,
        sentAt: null,
        attempts: 0,
        error: '',
        lastError: ''
      }
    },
    { new: true }
  ).lean();
};
