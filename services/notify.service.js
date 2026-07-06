import Notification from '../models/notification.model.js';
import { createId } from '../lib/id.js';
import { sendToUser } from './push.service.js';

/**
 * Single entry point for a user-facing notification. Emits through BOTH
 * channels so the system tray and the in-app bell stay in sync:
 *   1. persists an in-app Notification record (shows in NotificationsScreen)
 *   2. sends an FCM push (system tray — reaches the user when the app is
 *      backgrounded/terminated)
 *
 * Never throws: a failure to persist the in-app record is logged but still
 * attempts the push, and sendToUser is already best-effort. Returns the push
 * result summary from sendToUser.
 *
 * The created record's id is forwarded in the push `data` as `notificationId`
 * so a tap can later mark it read / open it.
 */
export const notifyUser = async (
  userId,
  { title, body, type = 'general', data = {}, ttlMs } = {}
) => {
  const safeTitle = String(title || '').trim();
  const safeBody = String(body || '').trim();

  let notificationId = '';
  try {
    const record = await Notification.create({
      _id: createId('notif'),
      userId,
      // title & body are required+trimmed on the model; fall back so a sparse
      // payload can't throw a validation error and lose the in-app record.
      title: safeTitle || 'Notification',
      body: safeBody || safeTitle || 'You have a new notification',
      type,
      read: false
    });
    notificationId = record._id;
  } catch (error) {
    console.error(
      `[notify.service] failed to persist in-app notification for ${userId}:`,
      error?.message || error
    );
  }

  return sendToUser(userId, {
    title: safeTitle,
    body: safeBody,
    data: { ...data, notificationId },
    ttlMs
  });
};
