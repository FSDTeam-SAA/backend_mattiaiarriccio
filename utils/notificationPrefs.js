/**
 * Central helpers for resolving a user's notification delivery preferences.
 * Shared by the reminder dispatcher and the admin sender so the "where do we
 * deliver, and is this channel enabled" logic lives in exactly one place.
 *
 * Precedence:
 *  - `notificationsEnabled === false` is a master opt-out (both channels off).
 *  - Email is delivered to `notificationEmail` when set, else the account email.
 */

/** The address reminder/notification emails are sent to. */
export const effectiveNotificationEmail = (user) =>
  String(user?.notificationEmail || user?.email || '')
    .trim()
    .toLowerCase();

/** True when push may be delivered to this user. */
export const pushEnabledForUser = (user) =>
  user?.notificationsEnabled !== false && user?.receivePushNotifications !== false;

/** True when email may be delivered to this user. */
export const emailEnabledForUser = (user) =>
  user?.notificationsEnabled !== false && user?.receiveEmailNotifications !== false;
