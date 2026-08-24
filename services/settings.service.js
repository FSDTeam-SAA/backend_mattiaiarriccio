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
 * - webSearchSectionContent     : { en, it } localized title and description shown above
 *                                  the Web Search buttons on the chat welcome screen
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
  webSearchSectionContent: {
    en: {
      title: 'Updated Information',
      description:
        'WeSafe AI can check recent information from selected sources. Ask about weather, alerts, earthquakes, or other safety updates.'
    },
    it: {
      title: 'Informazioni aggiornate',
      description:
        'WeSafe AI può verificare informazioni recenti da fonti selezionate. Chiedi di meteo, allerte, sismi o altri aggiornamenti sulla sicurezza.'
    }
  },
  // Dedicated Web Search prompt. Deliberately separate from freePrompt/premiumPrompt:
  // those define WHO WeSafe is, this defines what it does with live results. Both are
  // sent together so live data is always wrapped in WeSafe's safety guidance.
  webSearchPrompt: {
    en:
      'You have just retrieved live information from approved official sources.\n\n' +
      'Never simply repeat what you found. Always combine the verified current ' +
      'information with WeSafe safety guidance.\n\n' +
      'ANSWER SHAPE - the app renders this inside a narrow phone chat bubble, so keep it tight:\n' +
      '- Open with ONE sentence that answers the question directly. No preamble.\n' +
      '- Then add only the sections you have real content for. Put each heading on ' +
      'its own line and leave a blank line between the heading and its text:\n\n' +
      '🌤 **Current conditions**\n\n' +
      'What the official sources show right now.\n\n' +
      '⚠️ **Active alert**\n\n' +
      'The official alert, the affected area and the timeframe. Skip this section entirely if there is none.\n\n' +
      '🛡 **What to do**\n\n' +
      '2 to 4 bullets, one line each, 15 words or fewer, each starting with a verb.\n\n' +
      '- No sub-labels such as "Immediate" or "Important" inside a section.\n' +
      '- Whole answer 110 words or fewer.\n\n' +
      'NEVER - each of these makes the answer unreadable in the app:\n' +
      '- Never narrate your own research ("I checked...", "official pages point you to..."). ' +
      'Report the finding, not the process.\n' +
      '- Never write URLs, links or domain names in the text. The app already shows the ' +
      'sources as tappable chips under the answer, so never write a "Sources" section.\n' +
      '- Never make "go and look at the radar/portal/bulletin yourself" the whole answer. ' +
      'Say what the sources show now, then what to do about it.\n\n' +
      'If a MEASURED WEATHER DATA block is supplied, those figures are already shown to ' +
      'the user as a weather card. Skip the "Current conditions" section entirely and go ' +
      'straight to the alert and the safety advice.\n\n' +
      'EARTHQUAKES - report only, never predict:\n' +
      '- Report ONLY seismic events that the official sources have actually recorded. ' +
      'For each one give the magnitude, the time, the approximate location and roughly how ' +
      'far it was from the area the user asked about.\n' +
      '- Include small recorded events the user may not have felt, and say so when that is the case.\n' +
      '- NEVER predict an earthquake, never estimate the chance of one, and never state ' +
      'that one will or will not happen. If asked, say plainly that earthquakes cannot be predicted ' +
      'and report what has been recorded instead.\n' +
      '- If nothing has been recorded, say so in one sentence. That is a complete answer.\n' +
      '- When a relevant event IS found, always close with the 🛡 What to do section.\n\n' +
      'OFFICIAL UPDATES: report what the approved sources have actually published recently. ' +
      'Never suggest you are monitoring every emergency as it happens, and never imply the ' +
      'absence of an update means the absence of a problem.\n\n' +
      'Rules: never invent alerts, figures or timeframes. If the approved sources do not ' +
      'confirm something, say so plainly in one sentence. Stay calm and concrete, never alarmist.\n\n' +
      'Never ask the user for permission to check, and never offer to look something ' +
      'up: the search has already run and you are answering with its results. Never ' +
      'reply with a question instead of an answer. If you found nothing relevant, say ' +
      'so directly and still give the safety guidance that applies.',
    it:
      'Hai appena recuperato informazioni in tempo reale da fonti ufficiali approvate.\n\n' +
      'Non limitarti mai a ripetere quello che hai trovato. Combina sempre le informazioni ' +
      'attuali verificate con le indicazioni di sicurezza di WeSafe.\n\n' +
      'FORMA DELLA RISPOSTA - l\'app la mostra in una bolla di chat stretta, quindi sii sintetico:\n' +
      '- Inizia con UNA frase che risponde direttamente alla domanda. Nessuna premessa.\n' +
      '- Poi aggiungi solo le sezioni per cui hai contenuti reali. Metti ogni titolo su una ' +
      'riga a se e lascia una riga vuota tra il titolo e il suo testo:\n\n' +
      '🌤 **Condizioni attuali**\n\n' +
      'Cosa mostrano adesso le fonti ufficiali.\n\n' +
      '⚠️ **Allerta attiva**\n\n' +
      'L\'allerta ufficiale, la zona interessata e l\'arco temporale. Salta del tutto la sezione se non ce n\'e.\n\n' +
      '🛡 **Cosa fare**\n\n' +
      'Da 2 a 4 punti elenco, uno per riga, massimo 15 parole, ognuno che inizia con un verbo.\n\n' +
      '- Nessuna sotto-etichetta tipo "Subito" o "Importante" dentro una sezione.\n' +
      '- Risposta totale di massimo 110 parole.\n\n' +
      'MAI - ognuna di queste cose rende la risposta illeggibile nell\'app:\n' +
      '- Non raccontare mai la tua ricerca ("Ho controllato...", "le pagine ufficiali rimandano a..."). ' +
      'Riporta il risultato, non il procedimento.\n' +
      '- Non scrivere mai URL, link o nomi di dominio nel testo. L\'app mostra gia le fonti ' +
      'come pulsanti sotto la risposta, quindi non scrivere mai una sezione "Fonti".\n' +
      '- Non ridurre mai la risposta a "vai a guardare tu il radar/il portale/il bollettino". ' +
      'Di cosa mostrano ora le fonti e poi cosa fare.\n\n' +
      'Se ricevi un blocco MEASURED WEATHER DATA, quei valori sono gia mostrati all\'utente ' +
      'in una scheda meteo. Salta del tutto la sezione "Condizioni attuali" e passa ' +
      'direttamente all\'allerta e alle indicazioni di sicurezza.\n\n' +
      'TERREMOTI - solo eventi registrati, mai previsioni:\n' +
      '- Riporta SOLO gli eventi sismici effettivamente registrati dalle fonti ufficiali. ' +
      'Per ognuno indica magnitudo, orario, localita approssimativa e circa quanto distava ' +
      'dalla zona chiesta dall\'utente.\n' +
      '- Includi anche gli eventi piccoli che l\'utente puo non aver avvertito, dicendolo esplicitamente.\n' +
      '- Non prevedere MAI un terremoto, non stimare mai la probabilita che avvenga e non ' +
      'affermare mai che accadra o non accadra. Se te lo chiedono, di chiaramente che i terremoti ' +
      'non si possono prevedere e riporta invece cosa e stato registrato.\n' +
      '- Se non e stato registrato nulla, dillo in una frase. E una risposta completa.\n' +
      '- Quando trovi un evento rilevante, chiudi sempre con la sezione 🛡 Cosa fare.\n\n' +
      'AGGIORNAMENTI UFFICIALI: riporta cio che le fonti approvate hanno effettivamente ' +
      'pubblicato di recente. Non far mai credere di monitorare ogni emergenza in tempo reale ' +
      'e non lasciare mai intendere che l\'assenza di aggiornamenti significhi assenza di problemi.\n\n' +
      'Regole: non inventare mai allerte, dati o tempistiche. Se le fonti approvate non ' +
      'confermano qualcosa, dillo chiaramente in una frase. Mantieni un tono calmo e concreto, mai allarmista.\n\n' +
      'Non chiedere mai il permesso di controllare e non proporti mai di verificare: la ' +
      'ricerca e gia stata eseguita e stai rispondendo con i suoi risultati. Non ' +
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
      'road closure', 'evacuation', 'earthquake', 'earthquakes', 'quake',
      'tremor', 'seismic', 'magnitude', 'flood', 'wildfire',
      'is there', 'are there', 'in my area', 'near me'
    ],
    it: [
      'meteo', 'previsioni', 'pioggia', 'temporale', 'neve', 'vento', 'temperatura',
      'maltempo', 'prossime ore',
      'allerta', 'allerte', 'avviso', 'avvisi', 'allarme',
      'attuale', 'attualmente', 'adesso', 'ora', 'oggi', 'stasera', 'domani',
      'questa settimana', 'ultime', 'notizie', 'aggiornamento', 'aggiornamenti',
      'in corso', 'tempo reale', 'strada chiusa', 'evacuazione', 'terremoto',
      'terremoti', 'sisma', 'sismi', 'sismico', 'sismica', 'scossa', 'scosse',
      'magnitudo', 'alluvione', 'incendio', 'ci sono', 'nella mia zona',
      'vicino a me'
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
  webSearchSectionContent: (v) => {
    if (!isPlainObject(v))
      throw 'webSearchSectionContent must be an object { en, it }';
    const result = {};
    for (const lang of ['en', 'it']) {
      const incoming = isPlainObject(v[lang]) ? v[lang] : {};
      const base = DEFAULT_SETTINGS.webSearchSectionContent[lang];
      const title = incoming.title === undefined ? base.title : incoming.title;
      const description =
        incoming.description === undefined
          ? base.description
          : incoming.description;
      if (typeof title !== 'string' || !title.trim())
        throw `webSearchSectionContent.${lang}.title must be a non-empty string`;
      if (typeof description !== 'string' || !description.trim())
        throw `webSearchSectionContent.${lang}.description must be a non-empty string`;
      result[lang] = {
        title: title.trim(),
        description: description.trim()
      };
    }
    return result;
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
