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
 * Placeholder Live Information shortcuts, mirroring the four examples the client
 * gave. He is sending final wording in both languages; these exist so the flow
 * is testable and demoable before then, and are meant to be replaced from the
 * dashboard rather than edited here.
 *
 * Each `prompt` deliberately contains a word from webSearchTriggers so tapping
 * a shortcut reliably opens the live path.
 */
const DEFAULT_SUGGESTIONS = [
  {
    icon: '🌤',
    title: 'Weather in my area',
    prompt: 'What is the current weather in my area right now?',
    language: 'en',
    order: 0
  },
  {
    icon: '⚠️',
    title: 'Active alerts',
    prompt: 'Are there any active official alerts or warnings in my area today?',
    language: 'en',
    order: 1
  },
  {
    icon: '🌧',
    title: 'Severe weather in the next few hours',
    prompt: 'Is severe weather expected in my area in the next few hours?',
    language: 'en',
    order: 2
  },
  {
    icon: '🏛',
    title: 'Latest official updates',
    prompt: 'What are the latest official civil protection updates for my area?',
    language: 'en',
    order: 3
  },
  {
    icon: '🌤',
    title: 'Meteo nella mia zona',
    prompt: 'Qual è il meteo attuale nella mia zona adesso?',
    language: 'it',
    order: 0
  },
  {
    icon: '⚠️',
    title: 'Allerte attive',
    prompt: 'Ci sono allerte o avvisi ufficiali attivi nella mia zona oggi?',
    language: 'it',
    order: 1
  },
  {
    icon: '🌧',
    title: 'Maltempo nelle prossime ore',
    prompt: 'È previsto maltempo nella mia zona nelle prossime ore?',
    language: 'it',
    order: 2
  },
  {
    icon: '🏛',
    title: 'Ultimi aggiornamenti ufficiali',
    prompt:
      'Quali sono gli ultimi aggiornamenti ufficiali della protezione civile per la mia zona?',
    language: 'it',
    order: 3
  }
];

/**
 * Idempotent startup seeder for the Web Search feature.
 *
 * Only ever seeds a collection that is completely EMPTY, so an admin who has
 * curated or deleted entries never has them reappear on the next boot. Runs
 * alongside seedSettings() in server.js.
 */
export const seedWebSearchDefaults = async () => {
  const seeded = { domains: 0, suggestions: 0 };

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

  const suggestionCount = await LiveInfoSuggestion.estimatedDocumentCount();
  if (suggestionCount === 0) {
    await LiveInfoSuggestion.insertMany(
      DEFAULT_SUGGESTIONS.map((entry) => ({
        _id: createId('lis'),
        ...entry,
        active: true,
        createdBy: null
      }))
    );
    seeded.suggestions = DEFAULT_SUGGESTIONS.length;
  }

  if (seeded.domains || seeded.suggestions) {
    console.log(
      `[webSearchSeed] seeded ${seeded.domains} approved domains and ` +
        `${seeded.suggestions} live information suggestions`
    );
  }

  return seeded;
};
