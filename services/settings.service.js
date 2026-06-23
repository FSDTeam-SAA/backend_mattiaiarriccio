import { StatusCodes } from 'http-status-codes';
import AppSetting from '../models/appSetting.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * App configuration the admin edits live. Every hot path (limits, prompts,
 * ad config) reads through getSetting() which is backed by a ~30s in-memory cache.
 *
 * One-line summary of each key + default:
 * - freeDailyMessageLimit (20)   : max AI messages/day for free users
 * - freeDailyChatLimit (5)       : max new chats/day for free users
 * - freePrompt (string)          : system prompt used for free-tier chat
 * - premiumPrompt (string)       : system prompt used for premium-tier chat
 * - accessRules (object)         : misc gating flags (see DEFAULT_SETTINGS below)
 * - adsEnabled (true)            : master switch for ads (premium users never see ads)
 * - adConfig (object)            : { format, placements[], nativeFrequency }
 * - admUnitIds (object)          : AdMob unit ids per platform { android:{}, ios:{} }
 * - emergencyOverrideEnabled (true): if true, matched emergency responses bypass the AI
 * - reminderDefaults (object)    : default reminder offsets/channel for materials
 * - notificationsEnabled (true)  : master switch for the reminder/notification engine
 * - chatWelcomeMessage (object)  : { en, it } welcome bubble shown in chat on first open
 */
export const DEFAULT_SETTINGS = {
  freeDailyMessageLimit: 20,
  freeDailyChatLimit: 5,
  freePrompt:
    'You are WeSafe AI, a calm and concise safety assistant. Give clear, step-by-step emergency guidance. Keep answers short and practical for free users.',
  premiumPrompt:
    'You are WeSafe AI Premium, an expert safety assistant. Give thorough, well-structured emergency guidance with detailed steps, prevention tips, and follow-up advice.',
  accessRules: {
    premiumChecklistsLocked: true,
    premiumGuidesLocked: true,
    maxFreeMaterials: 0 // 0 = unlimited for everyone
  },
  adsEnabled: true,
  adConfig: {
    format: 'banner',
    placements: [],
    nativeFrequency: 5
  },
  admUnitIds: {
    android: { banner: '', native: '' },
    ios: { banner: '', native: '' }
  },
  emergencyOverrideEnabled: true,
  reminderDefaults: {
    offsetDays: [7, 1],
    channel: 'local'
  },
  notificationsEnabled: true,
  chatWelcomeMessage: {
    en:
      "Hello 👋\nI'm WeSafe AI, your assistant for safety, emergencies, and preparedness.\n\n" +
      'I can help you with:\n\n' +
      '* 🚨 Blackouts, fires, earthquakes, and floods\n' +
      '* 🧰 72h kits, home kits, and checklists\n' +
      '* 🩹 Basic first aid\n' +
      '* 🛡️ Practical safety advice\n\n' +
      'Examples:\n' +
      '👉 "What should I do during a blackout?"\n' +
      '👉 "What should I put in a 72h kit?"\n\n' +
      'Being prepared today can make a difference tomorrow.\n' +
      'Where would you like to start?',
    it:
      'Ciao 👋\nSono WeSafe AI, il tuo assistente dedicato a sicurezza, emergenze e preparazione.\n\n' +
      'Posso aiutarti con:\n\n' +
      '* 🚨 Blackout, incendi, terremoti e alluvioni\n' +
      '* 🧰 Kit 72h, kit casa e checklist\n' +
      '* 🩹 Primo soccorso base\n' +
      '* 🛡️ Consigli pratici per ridurre i rischi\n\n' +
      'Esempi:\n' +
      '👉 "Cosa fare durante un blackout?"\n' +
      '👉 "Cosa mettere in un kit 72h?"\n\n' +
      'Prepararsi oggi può fare la differenza domani.\n' +
      'Da dove vuoi iniziare?'
  }
};

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // key -> { value, expiresAt }

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isInteger = (value) => Number.isInteger(value);

const VALIDATORS = {
  freeDailyMessageLimit: (v) => {
    if (!isInteger(v) || v < 0) throw 'freeDailyMessageLimit must be an integer >= 0';
    return v;
  },
  freeDailyChatLimit: (v) => {
    if (!isInteger(v) || v < 0) throw 'freeDailyChatLimit must be an integer >= 0';
    return v;
  },
  freePrompt: (v) => {
    if (typeof v !== 'string' || !v.trim()) throw 'freePrompt must be a non-empty string';
    return v;
  },
  premiumPrompt: (v) => {
    if (typeof v !== 'string' || !v.trim()) throw 'premiumPrompt must be a non-empty string';
    return v;
  },
  adsEnabled: (v) => {
    if (typeof v !== 'boolean') throw 'adsEnabled must be a boolean';
    return v;
  },
  adConfig: (v) => {
    if (!isPlainObject(v)) throw 'adConfig must be an object';
    const allowedFormats = ['banner', 'native', 'banner+native'];
    if (!allowedFormats.includes(v.format)) {
      throw `adConfig.format must be one of: ${allowedFormats.join(', ')}`;
    }
    if (!Array.isArray(v.placements)) throw 'adConfig.placements must be an array of strings';
    const nativeFrequency = Number(v.nativeFrequency);
    if (!isInteger(nativeFrequency) || nativeFrequency < 1) {
      throw 'adConfig.nativeFrequency must be an integer >= 1';
    }
    return {
      format: v.format,
      placements: v.placements.map((p) => String(p)),
      nativeFrequency
    };
  },
  admUnitIds: (v) => {
    if (!isPlainObject(v)) throw 'admUnitIds must be an object { android, ios }';
    return v;
  },
  accessRules: (v) => {
    if (!isPlainObject(v)) throw 'accessRules must be an object';
    return v;
  },
  emergencyOverrideEnabled: (v) => {
    if (typeof v !== 'boolean') throw 'emergencyOverrideEnabled must be a boolean';
    return v;
  },
  reminderDefaults: (v) => {
    if (!isPlainObject(v)) throw 'reminderDefaults must be an object';
    return v;
  },
  notificationsEnabled: (v) => {
    if (typeof v !== 'boolean') throw 'notificationsEnabled must be a boolean';
    return v;
  },
  chatWelcomeMessage: (v) => {
    if (!isPlainObject(v)) throw 'chatWelcomeMessage must be an object { en: string, it: string }';
    if (v.en !== undefined && (typeof v.en !== 'string' || !v.en.trim()))
      throw 'chatWelcomeMessage.en must be a non-empty string';
    if (v.it !== undefined && (typeof v.it !== 'string' || !v.it.trim()))
      throw 'chatWelcomeMessage.it must be a non-empty string';
    return v;
  }
};

const setCache = (key, value) => {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

const readCache = (key) => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

export const invalidateSettingsCache = (key) => {
  if (key) cache.delete(key);
  else cache.clear();
};

export const getSettingKeys = () => Object.keys(DEFAULT_SETTINGS);

/**
 * Returns the value for a single key (cached). Falls back to the default if the
 * key has never been written to the DB.
 */
export const getSetting = async (key) => {
  if (!(key in DEFAULT_SETTINGS)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Unknown setting key: ${key}`);
  }

  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const doc = await AppSetting.findById(key).lean();
  const value = doc ? doc.value : DEFAULT_SETTINGS[key];
  setCache(key, value);
  return value;
};

/**
 * Returns the full resolved config object (defaults merged with DB overrides).
 */
export const getAllSettings = async () => {
  const docs = await AppSetting.find().lean();
  const overrides = {};
  for (const doc of docs) {
    overrides[doc._id] = doc.value;
  }

  const result = {};
  for (const key of getSettingKeys()) {
    result[key] = key in overrides ? overrides[key] : DEFAULT_SETTINGS[key];
    setCache(key, result[key]);
  }
  return result;
};

/**
 * Validates and persists a setting, then invalidates its cache entry.
 */
export const updateSetting = async (key, value, adminId = null) => {
  if (!(key in DEFAULT_SETTINGS)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Unknown setting key: ${key}`);
  }

  const validator = VALIDATORS[key];
  let normalized = value;
  if (validator) {
    try {
      normalized = validator(value);
    } catch (validationMessage) {
      throw new ApiError(StatusCodes.BAD_REQUEST, String(validationMessage));
    }
  }

  const doc = await AppSetting.findByIdAndUpdate(
    key,
    { _id: key, key, value: normalized, updatedBy: adminId },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  invalidateSettingsCache(key);
  setCache(key, doc.value);
  return doc;
};

/**
 * Updates several settings at once (used by the admin "save section" actions).
 */
export const updateSettings = async (patch, adminId = null) => {
  const results = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const doc = await updateSetting(key, value, adminId);
    results[key] = doc.value;
  }
  return results;
};

/**
 * Idempotent startup seeder: inserts any missing default key. Never overwrites
 * values an admin has already customised.
 */
export const seedSettings = async () => {
  const existing = await AppSetting.find().select('_id').lean();
  const existingKeys = new Set(existing.map((doc) => doc._id));

  const missing = getSettingKeys()
    .filter((key) => !existingKeys.has(key))
    .map((key) => ({ _id: key, key, value: DEFAULT_SETTINGS[key], updatedBy: null }));

  if (missing.length > 0) {
    await AppSetting.insertMany(missing);
  }

  invalidateSettingsCache();
  return missing.map((doc) => doc._id);
};
