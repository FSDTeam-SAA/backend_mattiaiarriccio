import crypto from 'crypto';
import { promisify } from 'util';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';

const scryptAsync = promisify(crypto.scrypt);

export const SESSION_TTL_HOURS = Number.parseInt(process.env.SESSION_TTL_HOURS || '168', 10);
export const OTP_TTL_MINUTES = Number.parseInt(process.env.RESET_OTP_TTL_MINUTES || '10', 10);

export const ensureEmail = (email) => {
  if (!email || !String(email).includes('@')) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'A valid email address is required');
  }

  return String(email).trim().toLowerCase();
};

export const ensurePasswordStrength = (password) => {
  if (!password || String(password).length < 8) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Password must be at least 8 characters long'
    );
  }

  return String(password);
};

export const ensureConfirmedPassword = (password, confirmPassword) => {
  if (password !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');
  }
};

export const hashPassword = async (password) => {
  const safePassword = ensurePasswordStrength(password);
  const salt = crypto.randomBytes(16).toString('hex');
  const hashBuffer = await scryptAsync(safePassword, salt, 64);

  return `${salt}:${Buffer.from(hashBuffer).toString('hex')}`;
};

export const verifyPassword = async (password, storedHash) => {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }

  const [salt, expectedHash] = storedHash.split(':');
  const derivedBuffer = await scryptAsync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(derivedBuffer);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

export const createOpaqueToken = (size = 32) => crypto.randomBytes(size).toString('hex');

export const createOtpCode = () => String(Math.floor(100000 + Math.random() * 900000));

export const maskEmail = (email) => {
  const [localPart, domain] = ensureEmail(email).split('@');

  if (localPart.length <= 2) {
    return `${localPart[0]}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}${'*'.repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
};

export const hoursFromNow = (hours) =>
  new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

export const minutesFromNow = (minutes) =>
  new Date(Date.now() + minutes * 60 * 1000).toISOString();

export const isExpired = (timestamp) => new Date(timestamp).getTime() <= Date.now();

export const createSlug = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const summarizeText = (value, maxLength = 90) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}…`;
};
