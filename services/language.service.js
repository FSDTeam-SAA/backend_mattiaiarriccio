import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import { appConfig } from '../data/appConfig.js';

const SUPPORTED_LANGUAGE_CODES = new Set(
  appConfig.supportedLanguages.map((language) => language.code)
);

const LANGUAGE_NAMES = {
  en: 'English',
  it: 'Italian'
};

const RESPONSE_MESSAGES = {
  en: {
    currentUserFetched: 'Current user fetched successfully',
    userPreferencesFetched: 'User preferences fetched successfully',
    preferencesUpdated: 'Preferences updated successfully',
    homeFetched: 'Home payload fetched successfully',
    chatProcessed: 'Chat message processed successfully',
    chatHistoryFetched: 'Chat history fetched successfully',
    conversationFetched: 'Conversation fetched successfully',
    conversationDeleted: 'Conversation deleted successfully',
    loggedIn: (role) => `${role === 'admin' ? 'Admin' : 'User'} logged in successfully`,
    registered: 'User registered successfully',
    socialLogin: 'Social login completed successfully',
    loggedOut: 'Logged out successfully'
  },
  it: {
    currentUserFetched: 'Utente corrente recuperato correttamente',
    userPreferencesFetched: 'Preferenze utente recuperate correttamente',
    preferencesUpdated: 'Preferenze aggiornate correttamente',
    homeFetched: 'Dati home recuperati correttamente',
    chatProcessed: 'Messaggio chat elaborato correttamente',
    chatHistoryFetched: 'Cronologia chat recuperata correttamente',
    conversationFetched: 'Conversazione recuperata correttamente',
    conversationDeleted: 'Conversazione eliminata correttamente',
    loggedIn: (role) =>
      `${role === 'admin' ? 'Admin' : 'Utente'} connesso correttamente`,
    registered: 'Utente registrato correttamente',
    socialLogin: 'Accesso social completato correttamente',
    loggedOut: 'Disconnessione completata correttamente'
  }
};

const HOME_COPY = {
  en: {
    greetingSubtitle:
      'Help is easier to reach when plans, guides, and chat are all in one place.',
    quickActions: {
      quick_ai_chat: {
        title: 'AI Chat Support',
        description: 'Get instant emergency guidance powered by the hosted AI backend.'
      },
      quick_guides: {
        title: 'Safety Guides',
        description: 'Read practical emergency instructions and category-based guides.'
      },
      quick_checklists: {
        title: 'Checklist',
        description: 'Track readiness and personal emergency supplies.'
      }
    }
  },
  it: {
    greetingSubtitle:
      'Aiuto piu facile da raggiungere quando piani, guide e chat sono nello stesso posto.',
    quickActions: {
      quick_ai_chat: {
        title: 'Supporto chat AI',
        description: 'Ricevi indicazioni immediate per le emergenze dal backend AI.'
      },
      quick_guides: {
        title: 'Guide di sicurezza',
        description: 'Leggi istruzioni pratiche per emergenze e guide per categoria.'
      },
      quick_checklists: {
        title: 'Checklist',
        description: 'Tieni traccia della preparazione e delle scorte di emergenza.'
      }
    }
  }
};

export const normalizeLanguageCode = (value, fallback = 'en') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace('_', '-');

  const code = normalized.split('-')[0];
  return SUPPORTED_LANGUAGE_CODES.has(code) ? code : fallback;
};

export const ensureSupportedLanguage = (value) => {
  const code = normalizeLanguageCode(value, '');

  if (!code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `preferredLanguage must be one of: ${[...SUPPORTED_LANGUAGE_CODES].join(', ')}`
    );
  }

  return code;
};

export const resolveRequestLanguage = (req, fallback = 'en') =>
  normalizeLanguageCode(
    req.body?.language ||
      req.body?.preferredLanguage ||
      req.query?.language ||
      req.headers['x-app-language'] ||
      req.headers['accept-language'],
    normalizeLanguageCode(fallback)
  );

export const messageFor = (language, key, ...args) => {
  const code = normalizeLanguageCode(language);
  const value = RESPONSE_MESSAGES[code]?.[key] || RESPONSE_MESSAGES.en[key] || key;

  return typeof value === 'function' ? value(...args) : value;
};

export const homeCopyFor = (language) =>
  HOME_COPY[normalizeLanguageCode(language)] || HOME_COPY.en;

export const languageInstructionFor = (language) => {
  const code = normalizeLanguageCode(language);
  const name = LANGUAGE_NAMES[code] || LANGUAGE_NAMES.en;

  return `Selected app language: ${name} (${code}). Respond only in ${name}, including emergency steps, warnings, and reminders, unless the user explicitly asks for another language.`;
};

