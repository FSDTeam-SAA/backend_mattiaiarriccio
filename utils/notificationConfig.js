/**
 * Feature flags for user-facing notification delivery.
 *
 * Email notification delivery is intentionally opt-in for this phase. Password
 * reset emails are transactional authentication messages and are not governed
 * by this flag.
 */
const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

export const isEmailNotificationsEnabled = () =>
  parseBoolean(process.env.EMAIL_NOTIFICATIONS_ENABLED, false);
