import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderWebSearchPrompt,
  sanitizeWebSearchReply,
  finalizeWebSearchReply,
  selectAllowedDomainsForSearch
} from '../services/ai.service.js';

test('earthquake searches use the approved INGV catalogue only', () => {
  const domains = [
    'meteoam.it',
    'mappe.protezionecivile.gov.it',
    'terremoti.ingv.it',
    'vigilfuoco.it'
  ];

  assert.deepEqual(
    selectAllowedDomainsForSearch(
      domains,
      'Which earthquakes were recorded near Apice in the last 24 hours?'
    ),
    ['terremoti.ingv.it']
  );
  assert.deepEqual(
    selectAllowedDomainsForSearch(domains, 'Are there weather alerts today?'),
    domains
  );
});

test('dashboard Web Search placeholders are filled for the live request', () => {
  const rendered = renderWebSearchPrompt(
    '{{SEARCH_MODE}}|{{USER_LANGUAGE}}|{{TIMEZONE}}|{{REQUESTED_LOCATION}}|{{USER_QUERY}}',
    {
      language: 'it',
      query: 'Ci sono terremoti recenti vicino ad Apice?',
      location: {
        city: 'Apice',
        region: 'Campania',
        country: 'IT',
        timezone: 'Europe/Rome'
      }
    }
  );

  assert.equal(
    rendered,
    'EARTHQUAKES|it|Europe/Rome|Apice, Campania, IT|Ci sono terremoti recenti vicino ad Apice?'
  );
  assert.doesNotMatch(rendered, /{{[A-Z_]+}}/);
});

test('stored Web Search answers remove inline links and duplicate source sections', () => {
  const cleaned = sanitizeWebSearchReply(
    'Nessun evento rilevante. ([ingv.it](https://terremoti.ingv.it/example?utm_source=openai))\n\n' +
      '🛡 **Cosa fare**\n\n- Mantieni pronto il piano familiare.\n\n' +
      'Fonti:\n- [INGV](https://terremoti.ingv.it/)\n\n' +
      'Vuoi che controlli anche Napoli?'
  );

  assert.equal(
    cleaned,
    'Nessun evento rilevante.\n\n🛡 **Cosa fare**\n\n- Mantieni pronto il piano familiare.'
  );
  assert.doesNotMatch(cleaned, /https?:\/\//);
  assert.doesNotMatch(cleaned, /Fonti:/);
  assert.doesNotMatch(cleaned, /Vuoi che/);
});

test('an empty earthquake result becomes the single required sentence', () => {
  const cleaned = finalizeWebSearchReply(
    'Sintesi:\n- Non risultano eventi sismici rilevanti registrati vicino ad Apice.\n\n' +
      'Dettagli:\n- Nessun terremoto pertinente trovato.\n\n' +
      'Cosa fare:\n- Controlla INGV.\n\n' +
      '(Se vuoi, posso ripetere la verifica per un intervallo diverso.)',
    {
      language: 'it',
      query: 'Ci sono terremoti recenti vicino ad Apice?'
    }
  );

  assert.equal(
    cleaned,
    'Non sono stati trovati terremoti rilevanti per la zona e il periodo richiesti nelle fonti approvate consultate.'
  );
});

test('the observed INGV no-result wording is also reduced to one sentence', () => {
  const cleaned = finalizeWebSearchReply(
    'No relevant earthquakes recorded by INGV within 24 hours near Apice.\n\n' +
      'What to do:\n- Check the website again later.',
    {
      language: 'en',
      query: 'Which earthquakes were recorded near Apice?'
    }
  );

  assert.equal(
    cleaned,
    'No relevant earthquakes were found for the requested area and time period in the approved sources checked.'
  );
});

test('safety headings use the shield treatment expected by the app', () => {
  assert.equal(
    finalizeWebSearchReply('Answer.\n\nWhat to do:\n- Move indoors.', {
      language: 'en',
      query: 'Are there weather alerts?'
    }),
    'Answer.\n\n🛡 **What to do**\n- Move indoors.'
  );
});
