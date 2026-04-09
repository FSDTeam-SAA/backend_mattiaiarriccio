export const parseMaybeJson = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  const looksLikeJson =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'));

  if (!looksLikeJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

export const parseArrayInput = (value) => {
  const parsed = parseMaybeJson(value);

  if (parsed === undefined) {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed === '') {
    return [];
  }

  return [parsed];
};

export const parseBooleanInput = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off', ''].includes(normalized)) {
    return false;
  }

  return Boolean(value);
};

export const parseIntegerInput = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};
