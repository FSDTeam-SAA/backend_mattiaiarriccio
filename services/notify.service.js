import Notification from '../models/notification.model.js';
import User from '../models/user.model.js';
import { createId } from '../lib/id.js';
import { sendToUser } from './push.service.js';
import { emitToUser } from './socket.service.js';
import { sendReminderEmail } from './email.service.js';
import {
  emailEnabledForType,
  effectiveNotificationEmail,
  NOTIFICATION_PREF_FIELDS
} from '../utils/notificationPrefs.js';

/**
 * Single entry point for a user-facing notification. It always persists an
 * in-app Notification record, and delivers to the channels the user has
 * enabled: FCM push (when sendPush) AND email (when sendEmail) — so email
 * mirrors push for every notification, gated by the user's per-channel and
 * per-category preferences.
 *
 * `sendEmail` defaults on. Callers that ALREADY enqueue a dedicated email job
 * for the same notification (checklist item reminders, admin campaigns, premium
 * lifecycle events) must pass `sendEmail: false` so the user is not emailed
 * twice — the separate email job handles their email.
 *
 * Never throws: a failure to persist the in-app record is logged but delivery
 * is still attempted, and both sendToUser and sendReminderEmail are best-effort.
 *
 * The created record's id is forwarded in the push data as notificationId so a
 * tap can later mark it read or open it.
 */
export const notifyUser = async (
  userId,
  { title, body, type = 'general', data = {}, ttlMs, sendPush = true, sendEmail = true } = {}
) => {
  const safeTitle = String(title || '').trim();
  const safeBody = String(body || '').trim();

  let notificationId = '';
  try {
    const record = await Notification.create({
      _id: createId('notif'),
      userId,
      // Fall back so a sparse payload cannot throw validation and lose the
      // in-app record.
      title: safeTitle || 'Notification',
      body: safeBody || safeTitle || 'You have a new notification',
      type,
      read: false
    });
    notificationId = record._id;

    // Realtime: push the new in-app notification to the user's socket room so the
    // bell/list updates instantly — independent of FCM. Best-effort; a missing
    // socket connection is a no-op.
    emitToUser(userId, 'newNotification', {
      id: record._id,
      userId,
      title: record.title,
      body: record.body,
      type: record.type,
      read: false,
      createdAt: record.createdAt
    });
  } catch (error) {
    console.error(
      `[notify.service] failed to persist in-app notification for ${userId}:`,
      error?.message || error
    );
  }

  const pushResult =
    sendPush === false
      ? { skipped: true, reason: 'push_disabled' }
      : await sendToUser(userId, {
          title: safeTitle,
          body: safeBody,
          data: { ...data, notificationId },
          ttlMs
        });

  // Email mirrors push: deliver the same notification by email when the user has
  // email enabled for this notification's category. Best-effort and never
  // throws. `email_suppressed` means the caller owns email via a separate job.
  let emailResult = { skipped: true, reason: 'email_suppressed' };
  if (sendEmail !== false) {
    try {
      const user = await User.findById(userId)
        .select(`${NOTIFICATION_PREF_FIELDS} email notificationEmail fullName`)
        .lean();
      if (user && emailEnabledForType(user, type)) {
        emailResult = await sendReminderEmail({
          toEmail: effectiveNotificationEmail(user),
          toName: user.fullName,
          title: safeTitle,
          body: safeBody
        });
      } else {
        emailResult = { skipped: true, reason: 'not_allowed' };
      }
    } catch (error) {
      emailResult = {
        skipped: true,
        reason: 'error',
        error: error?.message || String(error)
      };
    }
  }

  // Push fields stay at the top level for backwards compatibility (callers
  // inspect skipped/reason to decide push retries); the email outcome is nested.
  return { ...pushResult, notificationId, email: emailResult };
};
