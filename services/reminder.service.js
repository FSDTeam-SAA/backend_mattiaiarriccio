import NotificationJob from '../models/notificationJob.model.js';
import { createId } from '../lib/id.js';
import { getSetting } from './settings.service.js';
import { sendToUser } from './push.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const subtractDays = (date, days) => {
  const base = date instanceof Date ? date : new Date(date);
  return new Date(base.getTime() - Number(days || 0) * MS_PER_DAY);
};

const isFutureOrNow = (date) => date instanceof Date && date.getTime() > Date.now();

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
          data: { type: claimed.type, refId: claimed.refId || '' }
        });
        // sendToUser never throws; a skip is still a successful "intent recorded".
        if (result?.skipped) {
          // Keep as 'sent' (intent recorded) but note the reason for monitoring.
          await NotificationJob.updateOne(
            { _id: claimed._id },
            { $set: { error: `push skipped: ${result.reason || 'unknown'}` } }
          );
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
