import ApprovedDomain from '../models/approvedDomain.model.js';
import AppSetting from '../models/appSetting.model.js';
import LiveInfoSuggestion from '../models/liveInfoSuggestion.model.js';
import { createId } from '../lib/id.js';

const CONTENT_SEED_VERSION_KEY = 'webSearchWelcomeContentSeedVersion';
const CONTENT_SEED_VERSION = 2;

/**
 * Starter approved sources. Italian official bodies, since that is the launch
 * market. These are a starting point the admin is expected to edit - the point
 * of the feature is that the list lives in the dashboard, not in this file.
 */
const DEFAULT_DOMAINS = [
  {
    domain: 'protezionecivile.gov.it',
    label: 'Dipartimento della Protezione Civile',
    category: 'civil_protection',
    order: 0
  },
  {
    domain: 'meteoam.it',
    label: 'Servizio Meteorologico dell’Aeronautica Militare',
    category: 'weather',
    order: 1
  },
  {
    domain: 'ingv.it',
    label: 'Istituto Nazionale di Geofisica e Vulcanologia',
    category: 'official',
    order: 2
  },
  {
    domain: 'vigilfuoco.it',
    label: 'Corpo Nazionale dei Vigili del Fuoco',
    category: 'official',
    order: 3
  }
];

/**
 * The four Live Information buttons, in both languages.
 *
 * `{location}` is substituted by the app: either the user's own city or the one
 * they name when they choose "another location". Weather, alerts and seismic
 * activity all carry it because those answers are meaningless without a place;
 * official updates deliberately does not, since it is the broad "what has been
 * published lately" question.
 *
 * Each `prompt` also contains a word from webSearchTriggers, so tapping a
 * shortcut reliably opens the live path. Everything here is editable from the
 * dashboard - these values exist so a fresh install works, not as the final
 * wording.
 */
export const DEFAULT_LIVE_INFO_BUTTONS = [
  {
    icon: '🌤',
    title: 'Weather',
    prompt:
      'What is the current weather in {location} right now, and is anything expected in the next few hours?',
    requiresLocation: true,
    language: 'en',
    order: 0
  },
  {
    icon: '⚠️',
    title: 'Alerts',
    prompt:
      'Are there any active official alerts or warnings for {location} today?',
    requiresLocation: true,
    language: 'en',
    order: 1
  },
  {
    icon: '🌍',
    title: 'Earthquakes',
    prompt:
      'Have any earthquakes been recorded near {location} recently? Give the magnitude, the time and how far each was from the area.',
    requiresLocation: true,
    language: 'en',
    order: 2
  },
  {
    icon: '🏛',
    title: 'Official updates',
    prompt:
      'What are the latest safety-related updates published by the official civil protection sources?',
    requiresLocation: false,
    language: 'en',
    order: 3
  },
  {
    icon: '🌤',
    title: 'Meteo',
    prompt:
      'Qual è il meteo attuale a {location} adesso ed è previsto qualcosa nelle prossime ore?',
    requiresLocation: true,
    language: 'it',
    order: 0
  },
  {
    icon: '⚠️',
    title: 'Allerte',
    prompt:
      'Ci sono allerte o avvisi ufficiali attivi per {location} oggi?',
    requiresLocation: true,
    language: 'it',
    order: 1
  },
  {
    icon: '🌍',
    title: 'Sismi',
    prompt:
      'Sono stati registrati terremoti vicino a {location} di recente? Indica magnitudo, orario e distanza dalla zona.',
    requiresLocation: true,
    language: 'it',
    order: 2
  },
  {
    icon: '🏛',
    title: 'Aggiornamenti',
    prompt:
      'Quali sono gli ultimi aggiornamenti sulla sicurezza pubblicati dalle fonti ufficiali della protezione civile?',
    requiresLocation: false,
    language: 'it',
    order: 3
  }
];

/** Ordinary Quick Questions. Live-search discovery belongs in the dedicated
 * Web Search section below them, never in this list. */
export const DEFAULT_SUGGESTED_QUESTIONS = [
  {
    title: 'How do I prepare a 72-hour kit?',
    prompt: 'How do I prepare a 72-hour emergency kit?',
    requiresLocation: false,
    language: 'en',
    order: 0
  },
  {
    title: 'What should I do during a blackout?',
    prompt: 'What should I do during a blackout?',
    requiresLocation: false,
    language: 'en',
    order: 1
  },
  {
    title: 'How do I prepare a family emergency plan?',
    prompt: 'How do I prepare a family emergency plan?',
    requiresLocation: false,
    language: 'en',
    order: 2
  },
  {
    title: 'Come preparo un kit per 72 ore?',
    prompt: 'Come preparo un kit di emergenza per 72 ore?',
    requiresLocation: false,
    language: 'it',
    order: 0
  },
  {
    title: 'Cosa devo fare durante un blackout?',
    prompt: 'Cosa devo fare durante un blackout?',
    requiresLocation: false,
    language: 'it',
    order: 1
  },
  {
    title: 'Come preparo un piano di emergenza familiare?',
    prompt: 'Come preparo un piano di emergenza familiare per la mia famiglia?',
    requiresLocation: false,
    language: 'it',
    order: 2
  }
];

/** Small discovery prompts rendered under the four Web Search buttons. */
export const DEFAULT_WEB_SEARCH_EXAMPLES = [
  {
    title: 'Are there any active alerts in my area today?',
    prompt: 'Are there any active official alerts in my area today?',
    requiresLocation: false,
    language: 'en',
    order: 0
  },
  {
    title: 'Ci sono allerte attive oggi nella mia zona?',
    prompt: 'Ci sono allerte ufficiali attive oggi nella mia zona?',
    requiresLocation: false,
    language: 'it',
    order: 0
  }
];

// The first release accidentally put these live-search discovery prompts into
// Quick Questions. Remove only untouched system seeds (`createdBy: null`), so
// anything an admin created remains entirely under their control.
const LEGACY_SEARCH_QUICK_QUESTION_TITLES = [
  'Are there any active alerts in my area today?',
  'What will the weather be like this weekend?',
  'Have there been any recent earthquakes near me?',
  'What are the latest Civil Protection updates?',
  'Are severe thunderstorms expected in the next few hours?',
  'Ci sono allerte attive nella mia zona oggi?',
  'Che tempo farà questo fine settimana?',
  'Ci sono stati terremoti recenti vicino a me?',
  'Quali sono gli ultimi aggiornamenti della Protezione Civile?',
  'Sono previsti temporali forti nelle prossime ore?'
];

const separateLegacyQuickQuestions = async () => {
  const removed = await LiveInfoSuggestion.deleteMany({
    kind: 'suggested_question',
    createdBy: null,
    title: { $in: LEGACY_SEARCH_QUICK_QUESTION_TITLES }
  });

  await Promise.all(
    DEFAULT_SUGGESTED_QUESTIONS.map((entry) =>
      LiveInfoSuggestion.updateMany(
        {
          kind: 'suggested_question',
          createdBy: null,
          language: entry.language,
          title: entry.title
        },
        { $set: { order: entry.order } }
      )
    )
  );

  return removed.deletedCount || 0;
};

/**
 * Inserts one kind's defaults only when that kind holds nothing at all.
 * Existing lists are never merged with defaults, so admin edits are preserved.
 * Rows written before `kind` existed count as Live Information buttons.
 */
const seedSuggestions = async (kind, defaults) => {
  const filter =
    kind === 'live_info'
      ? { kind: { $in: [null, 'live_info'] } }
      : { kind };

  const existing = await LiveInfoSuggestion.countDocuments(filter);
  if (existing > 0) return 0;

  await LiveInfoSuggestion.insertMany(
    defaults.map((entry) => ({
      _id: createId('lis'),
      icon: '',
      ...entry,
      kind,
      active: true,
      createdBy: null
    }))
  );

  return defaults.length;
};

/**
 * Idempotent startup seeder for the Web Search feature.
 *
 * Seeds missing content groups independently and records a version marker, so
 * deleting every row from a group later does not resurrect defaults on restart.
 * It also performs the narrow one-time cleanup of untouched system prompts that
 * were placed in the wrong group by the first release.
 */
export const seedWebSearchDefaults = async () => {
  const seeded = {
    domains: 0,
    buttons: 0,
    questions: 0,
    examples: 0,
    removedLegacyQuestions: 0
  };

  const seedState = await AppSetting.findById(CONTENT_SEED_VERSION_KEY).lean();
  const parsedVersion = Number(seedState?.value ?? 0);
  const installedVersion = Number.isFinite(parsedVersion) ? parsedVersion : 0;

  if (installedVersion < CONTENT_SEED_VERSION) {
    const domainCount = await ApprovedDomain.estimatedDocumentCount();
    if (domainCount === 0) {
      await ApprovedDomain.insertMany(
        DEFAULT_DOMAINS.map((entry) => ({
          _id: createId('dom'),
          ...entry,
          active: true,
          createdBy: null
        }))
      );
      seeded.domains = DEFAULT_DOMAINS.length;
    }

    // Counted per kind rather than over the whole collection: each content group
    // arrived in a different release and needs its own first-run defaults.
    seeded.removedLegacyQuestions = await separateLegacyQuickQuestions();
    seeded.buttons = await seedSuggestions(
      'live_info',
      DEFAULT_LIVE_INFO_BUTTONS
    );
    seeded.questions = await seedSuggestions(
      'suggested_question',
      DEFAULT_SUGGESTED_QUESTIONS
    );
    seeded.examples = await seedSuggestions(
      'web_search_example',
      DEFAULT_WEB_SEARCH_EXAMPLES
    );

    await AppSetting.updateOne(
      { _id: CONTENT_SEED_VERSION_KEY },
      {
        $set: {
          key: CONTENT_SEED_VERSION_KEY,
          value: CONTENT_SEED_VERSION,
          updatedBy: null
        }
      },
      { upsert: true }
    );
  }

  if (
    seeded.domains ||
    seeded.buttons ||
    seeded.questions ||
    seeded.examples ||
    seeded.removedLegacyQuestions
  ) {
    console.log(
      `[webSearchSeed] seeded ${seeded.domains} approved domains, ` +
        `${seeded.buttons} live information buttons and ` +
        `${seeded.questions} quick questions and ` +
        `${seeded.examples} Web Search examples; removed ` +
        `${seeded.removedLegacyQuestions} legacy live-search Quick Questions`
    );
  }

  return seeded;
};
