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
 * - webSearchEnabled (true)      : master switch for OpenAI native Web Search
 * - webSearchFreeDailyLimit (2)  : max live searches/day for free users (0 = unlimited)
 * - webSearchPremiumDailyLimit (20): max live searches/day for premium users (0 = unlimited)
 * - webSearchContextSize ('low') : OpenAI search_context_size; the main cost lever
 * - webSearchPrompt (object)     : { en, it } dedicated prompt controlling how live
 *                                  results are combined with WeSafe safety guidance
 * - webSearchTriggers (object)   : { en[], it[] } keywords that make the web_search tool
 *                                  available. If none match, chat runs exactly as before.
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
    format: 'banner+native',
    placements: [],
    nativeFrequency: 5
  },
  admUnitIds: {
    android: {
      banner: 'ca-app-pub-4038790464586655/6165570201',
      native: 'ca-app-pub-4038790464586655/9262919524'
    },
    ios: {
      banner: 'ca-app-pub-4038790464586655/4010592843',
      native: 'ca-app-pub-4038790464586655/9071347838'
    }
  },
  emergencyOverrideEnabled: true,
  reminderDefaults: {
    offsetDays: [7, 1],
    channel: 'local'
  },
  notificationsEnabled: true,
  webSearchEnabled: true,
  webSearchFreeDailyLimit: 2,
  webSearchPremiumDailyLimit: 20,
  webSearchContextSize: 'low',
  // Dedicated Web Search prompt. Deliberately separate from freePrompt/premiumPrompt:
  // those define WHO WeSafe is, this defines what it does with live results. Both are
  // sent together so live data is always wrapped in WeSafe's safety guidance.
  webSearchPrompt: {
    en:
      'You have just retrieved live information from approved official sources.\n\n' +
      'Never simply repeat what you found. Always combine the verified current ' +
      'information with WeSafe safety guidance.\n\n' +
      'If conditions are normal, give the updated information briefly and list the sources.\n\n' +
      'If you find an official alert or warning, structure the answer exactly like this:\n\n' +
      '🌤 **Current conditions**\n' +
      'Updated information from the approved sources.\n\n' +
      '⚠️ **Active alert**\n' +
      'Clearly explain the official alert, the affected location and the relevant timeframe.\n\n' +
      '🛡 **What to do**\n' +
      '2-5 short, practical safety recommendations specific to this risk.\n\n' +
      '**Sources**\n' +
      'The official sources you used.\n\n' +
      'Rules: never invent alerts, figures or timeframes. If the approved sources do not ' +
      'confirm something, say so plainly. Stay calm and concrete, never alarmist.\n\n' +
      'Never ask the user for permission to check, and never offer to look something ' +
      'up: the search has already run and you are answering with its results. Never ' +
      'reply with a question instead of an answer. If you found nothing relevant, say ' +
      'so directly and still give the safety guidance that applies.',
    it:
      'Hai appena recuperato informazioni in tempo reale da fonti ufficiali approvate.\n\n' +
      'Non limitarti mai a ripetere quello che hai trovato. Combina sempre le informazioni ' +
      'attuali verificate con le indicazioni di sicurezza di WeSafe.\n\n' +
      'Se le condizioni sono normali, fornisci brevemente le informazioni aggiornate ed elenca le fonti.\n\n' +
      'Se trovi un avviso o un’allerta ufficiale, struttura la risposta esattamente così:\n\n' +
      '🌤 **Condizioni attuali**\n' +
      'Informazioni aggiornate dalle fonti approvate.\n\n' +
      '⚠️ **Allerta attiva**\n' +
      'Spiega chiaramente l’allerta ufficiale, la zona interessata e l’arco temporale.\n\n' +
      '🛡 **Cosa fare**\n' +
      '2-5 raccomandazioni di sicurezza brevi e pratiche, specifiche per questo rischio.\n\n' +
      '**Fonti**\n' +
      'Le fonti ufficiali che hai usato.\n\n' +
      'Regole: non inventare mai allerte, dati o tempistiche. Se le fonti approvate non ' +
      'confermano qualcosa, dillo chiaramente. Mantieni un tono calmo e concreto, mai allarmista.\n\n' +
      'Non chiedere mai il permesso di controllare e non proporti mai di verificare: la ' +
      'ricerca è già stata eseguita e stai rispondendo con i suoi risultati. Non ' +
      'rispondere mai con una domanda al posto di una risposta. Se non hai trovato nulla ' +
      'di rilevante, dillo direttamente e fornisci comunque le indicazioni di sicurezza utili.'
  },
  // The cost gate. If nothing here matches the user's message, the web_search tool is
  // never offered and the request follows the ordinary chat path at no extra cost.
  webSearchTriggers: {
    en: [
      'weather', 'forecast', 'rain', 'storm', 'snow', 'wind', 'temperature',
      'alert', 'alerts', 'warning', 'warnings', 'emergency alert',
      'current', 'currently', 'right now', 'today', 'tonight', 'tomorrow',
      'this week', 'latest', 'news', 'update', 'updates', 'happening',
      'road closure', 'evacuation', 'earthquake', 'flood', 'wildfire',
      'is there', 'are there', 'in my area', 'near me'
    ],
    it: [
      'meteo', 'previsioni', 'pioggia', 'temporale', 'neve', 'vento', 'temperatura',
      'maltempo', 'prossime ore',
      'allerta', 'allerte', 'avviso', 'avvisi', 'allarme',
      'attuale', 'attualmente', 'adesso', 'ora', 'oggi', 'stasera', 'domani',
      'questa settimana', 'ultime', 'notizie', 'aggiornamento', 'aggiornamenti',
      'in corso', 'tempo reale', 'strada chiusa', 'evacuazione', 'terremoto',
      'alluvione', 'incendio', 'ci sono', 'nella mia zona', 'vicino a me'
    ]
  },
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
  },
  // All text shown on the Premium / daily-limit paywall screen. Fully editable
  // by the admin; the app resolves it to the user's language.
  paywallContent: {
    en: {
      headline: 'Unlock WeSafe Premium',
      subheadline:
        "You've reached today's free limit. Upgrade for unlimited access.",
      limitReachedNote: 'Free plan: {limit} messages per day.',
      benefits: [
        'Unlimited AI safety assistant messages',
        'All premium checklists & guides',
        'Priority emergency playbooks',
        'No ads'
      ],
      monthlyLabel: 'Monthly',
      yearlyLabel: 'Yearly',
      yearlyBadge: 'Best value',
      ctaLabel: 'Go Premium',
      restoreLabel: 'Restore purchases',
      footnote: 'Cancel anytime.'
    },
    it: {
      headline: 'Sblocca WeSafe Premium',
      subheadline:
        'Hai raggiunto il limite gratuito di oggi. Passa a Premium per accesso illimitato.',
      limitReachedNote: 'Piano gratuito: {limit} messaggi al giorno.',
      benefits: [
        'Messaggi illimitati con l’assistente AI',
        'Tutte le checklist e guide premium',
        'Playbook di emergenza prioritari',
        'Nessuna pubblicità'
      ],
      monthlyLabel: 'Mensile',
      yearlyLabel: 'Annuale',
      yearlyBadge: 'Miglior valore',
      ctaLabel: 'Passa a Premium',
      restoreLabel: 'Ripristina acquisti',
      footnote: 'Disdici quando vuoi.'
    }
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
  webSearchEnabled: (v) => {
    if (typeof v !== 'boolean') throw 'webSearchEnabled must be a boolean';
    return v;
  },
  webSearchFreeDailyLimit: (v) => {
    if (!isInteger(v) || v < 0)
      throw 'webSearchFreeDailyLimit must be an integer >= 0 (0 = unlimited)';
    return v;
  },
  webSearchPremiumDailyLimit: (v) => {
    if (!isInteger(v) || v < 0)
      throw 'webSearchPremiumDailyLimit must be an integer >= 0 (0 = unlimited)';
    return v;
  },
  webSearchContextSize: (v) => {
    const allowed = ['low', 'medium', 'high'];
    if (!allowed.includes(v))
      throw `webSearchContextSize must be one of: ${allowed.join(', ')}`;
    return v;
  },
  webSearchPrompt: (v) => {
    if (!isPlainObject(v))
      throw 'webSearchPrompt must be an object { en: string, it: string }';
    const result = {};
    for (const lang of ['en', 'it']) {
      const incoming = v[lang];
      if (incoming === undefined) {
        result[lang] = DEFAULT_SETTINGS.webSearchPrompt[lang];
        continue;
      }
      if (typeof incoming !== 'string' || !incoming.trim())
        throw `webSearchPrompt.${lang} must be a non-empty string`;
      result[lang] = incoming;
    }
    return result;
  },
  webSearchTriggers: (v) => {
    if (!isPlainObject(v))
      throw 'webSearchTriggers must be an object { en: string[], it: string[] }';
    const result = {};
    for (const lang of ['en', 'it']) {
      const incoming = v[lang];
      if (incoming === undefined) {
        result[lang] = DEFAULT_SETTINGS.webSearchTriggers[lang];
        continue;
      }
      if (!Array.isArray(incoming))
        throw `webSearchTriggers.${lang} must be an array of strings`;
      result[lang] = incoming
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean);
    }
    return result;
  },
  chatWelcomeMessage: (v) => {
    if (!isPlainObject(v)) throw 'chatWelcomeMessage must be an object { en: string, it: string }';
    if (v.en !== undefined && (typeof v.en !== 'string' || !v.en.trim()))
      throw 'chatWelcomeMessage.en must be a non-empty string';
    if (v.it !== undefined && (typeof v.it !== 'string' || !v.it.trim()))
      throw 'chatWelcomeMessage.it must be a non-empty string';
    return v;
  },
  paywallContent: (v) => {
    if (!isPlainObject(v)) throw 'paywallContent must be an object { en, it }';
    const stringFields = [
      'headline',
      'subheadline',
      'limitReachedNote',
      'monthlyLabel',
      'yearlyLabel',
      'yearlyBadge',
      'ctaLabel',
      'restoreLabel',
      'footnote'
    ];
    const result = {};
    for (const lang of ['en', 'it']) {
      const incoming = isPlainObject(v[lang]) ? v[lang] : {};
      const base = DEFAULT_SETTINGS.paywallContent[lang];
      const merged = {};
      for (const field of stringFields) {
        merged[field] =
          typeof incoming[field] === 'string' ? incoming[field] : base[field];
      }
      merged.benefits = Array.isArray(incoming.benefits)
        ? incoming.benefits.map((b) => String(b).trim()).filter(Boolean)
        : base.benefits;
      result[lang] = merged;
    }
    return result;
  }
};

/**
 * Resolves the localized paywall content for a given language, with the {limit}
 * placeholder in limitReachedNote substituted with the caller's daily message
 * limit. Falls back to English, then to whatever language is present.
 */
export const getResolvedPaywallContent = async (language, messageLimit) => {
  const content = await getSetting('paywallContent');
  const lang = language === 'it' ? 'it' : 'en';
  const localized =
    (isPlainObject(content) && (content[lang] || content.en || content.it)) ||
    DEFAULT_SETTINGS.paywallContent.en;

  const limitText =
    messageLimit === null || messageLimit === undefined
      ? ''
      : String(messageLimit);

  return {
    ...localized,
    limitReachedNote: String(localized.limitReachedNote || '').replace(
      '{limit}',
      limitText
    )
  };
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
