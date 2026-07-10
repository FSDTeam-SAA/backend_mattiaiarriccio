/**
 * Timezone-aware reminder scheduling.
 *
 * Reminders used to inherit the time-of-day encoded in `expirationDate`. A date
 * entered as `2026-07-10` is stored as midnight UTC, and because the server runs
 * in UTC the reminder fired at 02:00 Europe/Rome. Users expect reminders at a
 * civil hour in their OWN timezone, so we rebuild the instant from the user's
 * wall-clock preference instead of reusing the stored one.
 *
 * Node ships full ICU, so Intl is enough — no timezone dependency required.
 */

export const DEFAULT_REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_MINUTE = 0;
export const DEFAULT_TIMEZONE = 'Europe/Rome';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const isValidTimeZone = (timeZone) => {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const safeZone = (timeZone) => (isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE);

const partsInZone = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // ICU can render midnight as hour "24" under hour12:false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
};

/** Offset (ms) that `timeZone` is ahead of UTC at the given instant. */
const zoneOffsetMs = (date, timeZone) => {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - date.getTime();
};

/** The calendar date (in `timeZone`) on which `date` falls. */
export const zonedCalendarDate = (date, timeZone) => {
  const zone = safeZone(timeZone);
  const { year, month, day } = partsInZone(new Date(date), zone);
  return { year, month, day };
};

/**
 * The UTC instant at which the wall clock in `timeZone` reads the given
 * date/time. Resolved twice because the offset itself depends on the instant we
 * are solving for — one refinement settles DST boundaries.
 */
export const zonedWallTimeToUtc = ({ year, month, day, hour, minute, timeZone }) => {
  const zone = safeZone(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let instant = naive - zoneOffsetMs(new Date(naive), zone);
  instant = naive - zoneOffsetMs(new Date(instant), zone);

  return new Date(instant);
};

/**
 * When a reminder `offsetDays` before `expirationDate` should actually fire:
 * that many calendar days earlier, at the user's preferred local time.
 */
export const reminderInstantFor = ({
  expirationDate,
  offsetDays = 0,
  hour = DEFAULT_REMINDER_HOUR,
  minute = DEFAULT_REMINDER_MINUTE,
  timeZone = DEFAULT_TIMEZONE
}) => {
  const zone = safeZone(timeZone);
  const expiry = expirationDate instanceof Date ? expirationDate : new Date(expirationDate);
  if (Number.isNaN(expiry.getTime())) return null;

  // Take the expiry's calendar day as the user sees it, step back whole
  // calendar days, then anchor to their preferred hour.
  const { year, month, day } = zonedCalendarDate(expiry, zone);
  const shifted = new Date(Date.UTC(year, month - 1, day) - Number(offsetDays || 0) * MS_PER_DAY);

  return zonedWallTimeToUtc({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: clampHour(hour),
    minute: clampMinute(minute),
    timeZone: zone
  });
};

export const clampHour = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_REMINDER_HOUR;
};

export const clampMinute = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 59 ? n : DEFAULT_REMINDER_MINUTE;
};

/** Reminder preferences for a user document, with defaults applied. */
export const reminderPrefsOf = (user) => ({
  hour: clampHour(user?.reminderHour),
  minute: clampMinute(user?.reminderMinute),
  timeZone: safeZone(user?.timezone)
});
