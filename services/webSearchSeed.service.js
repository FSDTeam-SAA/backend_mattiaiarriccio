import ApprovedDomain from '../models/approvedDomain.model.js';
import LiveInfoSuggestion from '../models/liveInfoSuggestion.model.js';
import { createId } from '../lib/id.js';

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

/**
 * Suggested Questions: deliberately a mix.
 *
 * The first few need a live lookup, the rest WeSafe answers from its own
 * guidance. Seeing both in one list is what teaches the user that the
 * assistant does both, without any explanatory copy having to say so.
 */
export const DEFAULT_SUGGESTED_QUESTIONS = [
  {
    title: 'Are there any active alerts in my area today?',
    prompt: 'Are there any active official alerts in my area today?',
    requiresLocation: false,
    language: 'en',
    order: 0
  },
  {
    title: 'What will the weather be like this weekend?',
    prompt: 'What will the weather be like in my area this weekend?',
    requiresLocation: false,
    language: 'en',
    order: 1
  },
  {
    title: 'Have there been any recent earthquakes near me?',
    prompt:
      'Have any earthquakes been recorded near me recently, and what was the magnitude?',
    requiresLocation: false,
    language: 'en',
    order: 2
  },
  {
    title: 'What are the latest Civil Protection updates?',
    prompt: 'What are the latest official Civil Protection updates?',
    requiresLocation: false,
    language: 'en',
    order: 3
  },
  {
    title: 'Are severe thunderstorms expected in the next few hours?',
    prompt:
      'Are severe thunderstorms expected in my area in the next few hours?',
    requiresLocation: false,
    language: 'en',
    order: 4
  },
  {
    title: 'How do I prepare a 72-hour kit?',
    prompt: 'How do I prepare a 72-hour emergency kit?',
    requiresLocation: false,
    language: 'en',
    order: 5
  },
  {
    title: 'What should I do during a blackout?',
    prompt: 'What should I do during a blackout?',
    requiresLocation: false,
    language: 'en',
    order: 6
  },
  {
    title: 'How do I prepare a family emergency plan?',
    prompt: 'How do I prepare a family emergency plan?',
    requiresLocation: false,
    language: 'en',
    order: 7
  },
  {
    title: 'Ci sono allerte attive nella mia zona oggi?',
    prompt: 'Ci sono allerte ufficiali attive nella mia zona oggi?',
    requiresLocation: false,
    language: 'it',
    order: 0
  },
  {
    title: 'Che tempo farà questo fine settimana?',
    prompt: 'Che tempo farà nella mia zona questo fine settimana?',
    requiresLocation: false,
    language: 'it',
    order: 1
  },
  {
    title: 'Ci sono stati terremoti recenti vicino a me?',
    prompt:
      'Sono stati registrati terremoti vicino a me di recente e con quale magnitudo?',
    requiresLocation: false,
    language: 'it',
    order: 2
  },
  {
    title: 'Quali sono gli ultimi aggiornamenti della Protezione Civile?',
    prompt:
      'Quali sono gli ultimi aggiornamenti ufficiali della Protezione Civile?',
    requiresLocation: false,
    language: 'it',
    order: 3
  },
  {
    title: 'Sono previsti temporali forti nelle prossime ore?',
    prompt: 'Sono previsti temporali forti nella mia zona nelle prossime ore?',
    requiresLocation: false,
    language: 'it',
    order: 4
  },
  {
    title: 'Come preparo un kit per 72 ore?',
    prompt: 'Come preparo un kit di emergenza per 72 ore?',
    requiresLocation: false,
    language: 'it',
    order: 5
  },
  {
    title: 'Cosa devo fare durante un blackout?',
    prompt: 'Cosa devo fare durante un blackout?',
    requiresLocation: false,
    language: 'it',
    order: 6
  },
  {
    title: 'Come preparo un piano di emergenza familiare?',
    prompt: 'Come preparo un piano di emergenza familiare per la mia famiglia?',
    requiresLocation: false,
    language: 'it',
    order: 7
  }
];

/**
 * Inserts one kind's defaults, and only when that kind holds nothing at all.
 *
 * An admin who curated or deleted rows must never see them reappear on the next
 * boot, so this is a "has the admin seen this list yet?" check, not a merge.
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
 * Only ever seeds a collection that is completely EMPTY, so an admin who has
 * curated or deleted entries never has them reappear on the next boot. Runs
 * alongside seedSettings() in server.js.
 */
export const seedWebSearchDefaults = async () => {
  const seeded = { domains: 0, buttons: 0, questions: 0 };

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

  // Counted per kind rather than over the whole collection: the Suggested
  // Questions arrived after the Live Information buttons, and a collection-wide
  // count would have left every existing install without them forever.
  seeded.buttons = await seedSuggestions('live_info', DEFAULT_LIVE_INFO_BUTTONS);
  seeded.questions = await seedSuggestions(
    'suggested_question',
    DEFAULT_SUGGESTED_QUESTIONS
  );

  if (seeded.domains || seeded.buttons || seeded.questions) {
    console.log(
      `[webSearchSeed] seeded ${seeded.domains} approved domains, ` +
        `${seeded.buttons} live information buttons and ` +
        `${seeded.questions} suggested questions`
    );
  }

  return seeded;
};
