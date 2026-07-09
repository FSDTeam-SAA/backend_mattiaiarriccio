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

/**
 * Maps a notification `type` to one of the four user-facing preference
 * categories. Anything unmapped falls under `appUpdates` (general
 * announcements), which is the safest bucket for admin/custom sends.
 */
const CATEGORY_BY_TYPE = {
  material_expiry: 'reminders',
  inspection: 'reminders',
  checklist_item: 'reminders',
  premium: 'premiumOffers',
  premium_offer: 'premiumOffers',
  premium_expiry: 'premiumOffers',
  premium_granted: 'premiumOffers',
  guide_update: 'guideUpdates',
  app_update: 'appUpdates',
  custom: 'appUpdates',
  general: 'appUpdates'
};

/** The User field that toggles each category. */
const CATEGORY_FIELD = {
  reminders: 'notifyReminders',
  guideUpdates: 'notifyGuideUpdates',
  premiumOffers: 'notifyPremiumOffers',
  appUpdates: 'notifyAppUpdates'
};

export const categoryForType = (type) =>
  CATEGORY_BY_TYPE[String(type || '').trim()] || 'appUpdates';

/** True when the user has NOT opted out of this notification's category. */
export const categoryEnabledForUser = (user, type) => {
  const field = CATEGORY_FIELD[categoryForType(type)];
  return user?.[field] !== false;
};

/** Push allowed for this user AND this notification's category. */
export const pushEnabledForType = (user, type) =>
  pushEnabledForUser(user) && categoryEnabledForUser(user, type);

/** Email allowed for this user AND this notification's category. */
export const emailEnabledForType = (user, type) =>
  emailEnabledForUser(user) && categoryEnabledForUser(user, type);

/** The extra User fields callers must `.select()` for category gating. */
export const NOTIFICATION_PREF_FIELDS =
  'notificationsEnabled receivePushNotifications receiveEmailNotifications notifyReminders notifyGuideUpdates notifyPremiumOffers notifyAppUpdates';
