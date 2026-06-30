import NotificationJob from '../models/notificationJob.model.js';
import User from '../models/user.model.js';
import { createId } from '../lib/id.js';
import { getSetting } from './settings.service.js';
import { sendToUser } from './push.service.js';
import { sendReminderEmail } from './email.service.js';

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

      jobs.push({
        _id: createId('notifjob'),
        userId: material.userId,
        type: 'material_expiry',
        refId: material._id,
        title: 'Material expiring soon',
        body: `${material.name} expires on ${new Date(
          material.expirationDate
        ).toISOString().slice(0, 10)}.`,
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
  // If the user enabled a reminder but no channel, default to push so the
  // reminder still surfaces on the device.
  if (channels.length === 0) channels.push('push');

  const title = 'Checklist reminder';
  const body = `"${item.text}" is due on ${formatDay(item.expirationDate)}.`;

  for (const channel of channels) {
    jobs.push({
      _id: createId('notifjob'),
      userId,
      type: 'checklist_item',
      refId: item._id,
      title,
      body,
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

/**
 * Deliver every due pending job. Called by the scheduler every couple of minutes.
 * - Skips entirely when notificationsEnabled is false.
 * - For each due job, atomically flips pending -> sent BEFORE dispatch using a
 *   status:'pending' guard so two overlapping ticks can never double-send.
 * - channel 'push' -> push.service.sendToUser; channel 'local' -> mark sent
 *   (the Flutter client schedules a local notification; the server only records intent).
 * - On error, the job is marked failed; the loop never throws.
 */
export const dispatchDueJobs = async () => {
  let notificationsEnabled = true;
  try {
    notificationsEnabled = await getSetting('notificationsEnabled');
  } catch {
    notificationsEnabled = true;
  }

  if (notificationsEnabled === false) {
    return { processed: 0, sent: 0, failed: 0, skipped: true };
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
        const result = await sendToUser(claimed.userId, {
          title: claimed.title,
          body: claimed.body,
          data: { type: claimed.type, refId: claimed.refId || '', screen: 'home' }
        });
        // sendToUser never throws; a skip is still a successful "intent recorded".
        if (result?.skipped) {
          // Keep as 'sent' (intent recorded) but note the reason for monitoring.
          await NotificationJob.updateOne(
            { _id: claimed._id },
            { $set: { error: `push skipped: ${result.reason || 'unknown'}` } }
          );
        }
      } else if (claimed.channel === 'email') {
        const user = await User.findById(claimed.userId)
          .select('email fullName notificationsEnabled')
          .lean();

        // Respect a per-user opt-out without failing the job.
        if (user && user.notificationsEnabled === false) {
          await NotificationJob.updateOne(
            { _id: claimed._id },
            { $set: { error: 'email skipped: user opted out' } }
          );
        } else {
          const result = await sendReminderEmail({
            toEmail: user?.email,
            toName: user?.fullName,
            title: claimed.title,
            body: claimed.body
          });
          if (result?.skipped) {
            await NotificationJob.updateOne(
              { _id: claimed._id },
              { $set: { error: `email skipped: ${result.reason || 'unknown'}` } }
            );
          }
        }
      }
      // channel 'local': nothing to deliver server-side; already marked sent.
      sent += 1;
    } catch (error) {
      failed += 1;
      await NotificationJob.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: 'failed',
            error: String(error?.message || error).slice(0, 500)
          }
        }
      );
    }
  }

  return { processed, sent, failed, skipped: false };
};
