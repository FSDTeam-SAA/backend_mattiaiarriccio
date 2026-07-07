import Notification from '../models/notification.model.js';
import { createId } from '../lib/id.js';
import { sendToUser } from './push.service.js';
import { emitToUser } from './socket.service.js';

/**
 * Single entry point for a user-facing notification. It always persists an
 * in-app Notification record and can optionally send an FCM push.
 *
 * Never throws: a failure to persist the in-app record is logged but still
 * attempts push when requested, and sendToUser is already best-effort.
 *
 * The created record's id is forwarded in the push data as notificationId so a
 * tap can later mark it read or open it.
 */
export const notifyUser = async (
  userId,
  { title, body, type = 'general', data = {}, ttlMs, sendPush = true } = {}
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

  if (sendPush === false) {
    return { skipped: true, reason: 'push_disabled', notificationId };
  }

  return sendToUser(userId, {
    title: safeTitle,
    body: safeBody,
    data: { ...data, notificationId },
    ttlMs
  });
};
