import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesTriggers,
  shouldConsiderWebSearch,
  extractSources,
  responseUsedWebSearch,
  buildUserLocation,
  MAX_SOURCES_SHOWN
} from '../services/webSearch.service.js';
import { DEFAULT_SETTINGS } from '../services/settings.service.js';
import {
  normalizeDomain,
  isValidDomain
} from '../models/approvedDomain.model.js';

const EN = DEFAULT_SETTINGS.webSearchTriggers.en;
const IT = DEFAULT_SETTINGS.webSearchTriggers.it;

/* ------------------------------------------------------------------ *
 * The cost gate. These are the cases the client explicitly called out.
 * ------------------------------------------------------------------ */

test('ordinary preparedness questions never reach the search path', () => {
  const cases = [
    ['What should I put in a 72-hour kit?', EN],
    ['How do I treat a burn?', EN],
    ['What should I do during a blackout?', EN],
    ['Cosa devo mettere in un kit 72h?', IT],
    ['Come si tratta una ustione?', IT]
  ];

  for (const [message, triggers] of cases) {
    assert.equal(
      matchesTriggers(message, triggers),
      false,
      `"${message}" must not trigger a web search`
    );
  }
});

test('live-information questions do reach the search path', () => {
  const cases = [
    ['Are there any weather alerts today in Naples?', EN],
    ['What is the weather right now?', EN],
    ['Any official updates on the flood?', EN],
    ['Ci sono allerte meteo oggi a Napoli?', IT],
    ['Che tempo fa adesso?', IT],
    ['E previsto maltempo nelle prossime ore?', IT]
  ];

  for (const [message, triggers] of cases) {
    assert.equal(
      matchesTriggers(message, triggers),
      true,
      `"${message}" must trigger a web search`
    );
  }
});

test('Italian accents and punctuation do not defeat the gate', () => {
  assert.equal(matchesTriggers('È previsto maltempo?', IT), true);
  assert.equal(matchesTriggers('Ci sono allerte, oggi?', IT), true);
  assert.equal(matchesTriggers('QUAL È IL METEO?', IT), true);
});

test('single-word triggers match whole words only', () => {
  // "ora" must not fire inside "lavoratore" / "ristorante".
  assert.equal(matchesTriggers('Come divento un lavoratore?', IT), false);
  assert.equal(matchesTriggers('Che ora e?', IT), true);
});

test('multi-word triggers match as phrases', () => {
  assert.equal(matchesTriggers('Cosa succede nella mia zona?', IT), true);
  assert.equal(matchesTriggers('Is there flooding near me?', EN), true);
});

test('empty or missing input never triggers a search', () => {
  assert.equal(matchesTriggers('', EN), false);
  assert.equal(matchesTriggers(null, EN), false);
  assert.equal(matchesTriggers('weather', undefined), false);
  assert.equal(matchesTriggers('weather', []), false);
});

test('a dedicated Live Information action bypasses trigger matching', async () => {
  assert.equal(
    await shouldConsiderWebSearch({
      text: 'An admin-edited shortcut with no trigger words',
      language: 'en',
      force: true
    }),
    true
  );
});

/* ------------------------------------------------------------------ *
 * The "every seeded shortcut opens the live path" assertion moved to
 * tests/welcomePrompts.test.js, where it reads the exported seed content
 * instead of a hand-copied duplicate of it that drifted out of date.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Domain normalisation
 * ------------------------------------------------------------------ */

test('domains normalise to the bare host OpenAI expects', () => {
  const cases = [
    ['https://www.protezionecivile.gov.it/en/', 'protezionecivile.gov.it'],
    ['HTTP://MeteoAM.it', 'meteoam.it'],
    ['www.ingv.it', 'ingv.it'],
    ['vigilfuoco.it/path?a=b#c', 'vigilfuoco.it'],
    ['example.com:8080', 'example.com'],
    ['  protezionecivile.gov.it.  ', 'protezionecivile.gov.it']
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeDomain(input), expected, `normalising "${input}"`);
  }
});

test('domain validation rejects things that are not hostnames', () => {
  assert.equal(isValidDomain('protezionecivile.gov.it'), true);
  assert.equal(isValidDomain('meteoam.it'), true);
  assert.equal(isValidDomain('localhost'), false);
  assert.equal(isValidDomain('not a domain'), false);
  assert.equal(isValidDomain(''), false);
});

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

const responseWithSearch = {
  output: [
    {
      type: 'web_search_call',
      action: {
        sources: [
          { url: 'https://meteoam.it/page-b', title: 'Consulted only' },
          { url: 'https://protezionecivile.gov.it/allerta', title: 'Dup' }
        ]
      }
    },
    {
      type: 'message',
      content: [
        {
          annotations: [
            {
              type: 'url_citation',
              url: 'https://protezionecivile.gov.it/allerta',
              title: 'Allerta meteo'
            }
          ]
        }
      ]
    }
  ]
};

test('cited sources come first and duplicates collapse', () => {
  const sources = extractSources(responseWithSearch);

  assert.equal(sources.length, 2);
  assert.equal(sources[0].url, 'https://protezionecivile.gov.it/allerta');
  assert.equal(sources[0].title, 'Allerta meteo');
  assert.equal(sources[0].domain, 'protezionecivile.gov.it');
  assert.equal(sources[1].domain, 'meteoam.it');
});

test('a source with no title falls back to its domain', () => {
  const [source] = extractSources({
    output: [
      {
        type: 'web_search_call',
        action: { sources: [{ url: 'https://www.ingv.it/x' }] }
      }
    ]
  });

  assert.equal(source.title, 'ingv.it');
  assert.equal(source.domain, 'ingv.it');
});

test('the same page cited and consulted collapses into one source', () => {
  // A real gpt-5-mini response returns the cited URL with OpenAI's utm tag and
  // the consulted URL without it. Those are one page, not two.
  const sources = extractSources({
    output: [
      {
        type: 'web_search_call',
        action: {
          sources: [
            { url: 'https://mappe.protezionecivile.gov.it/it/bollettino/' }
          ]
        }
      },
      {
        type: 'message',
        content: [
          {
            annotations: [
              {
                type: 'url_citation',
                url: 'https://mappe.protezionecivile.gov.it/it/bollettino/?utm_source=openai',
                title: 'Bollettino di Criticita'
              }
            ]
          }
        ]
      }
    ]
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'Bollettino di Criticita');
});

test('a consulted page contributes its title when the citation had none', () => {
  const [source] = extractSources({
    output: [
      {
        type: 'message',
        content: [
          {
            annotations: [
              {type: 'url_citation', url: 'https://ingv.it/a', title: ''}
            ]
          }
        ]
      },
      {
        type: 'web_search_call',
        action: {sources: [{url: 'https://ingv.it/a', title: 'Real title'}]}
      }
    ]
  });

  assert.equal(source.title, 'Real title');
});

test('sources are capped so one search cannot bury the answer', () => {
  // A single live search legitimately consults 20+ pages across several sites.
  const consulted = [];
  for (const host of ['a.gov.it', 'b.gov.it', 'c.gov.it', 'd.gov.it', 'e.gov.it']) {
    for (let i = 0; i < 5; i += 1) {
      consulted.push({url: `https://${host}/page-${i}`, title: `${host} ${i}`});
    }
  }

  const sources = extractSources({
    output: [{type: 'web_search_call', action: {sources: consulted}}]
  });

  assert.equal(sources.length, MAX_SOURCES_SHOWN);
});

test('no single domain may fill the whole source list', () => {
  // Observed in a real run: 19 of 19 sources were the same site, so every chip
  // rendered identically and told the user nothing.
  const consulted = Array.from({length: 25}, (_, i) => ({
    url: `https://protezionecivile.gov.it/page-${i}`,
    title: `Page ${i}`
  }));

  const sources = extractSources({
    output: [{type: 'web_search_call', action: {sources: consulted}}]
  });

  assert.ok(
    sources.length < MAX_SOURCES_SHOWN,
    'one domain should not be able to fill every slot'
  );
  assert.ok(sources.length >= 1);
  assert.equal(new Set(sources.map((s) => s.domain)).size, 1);
});

test('cited sources survive the cap ahead of merely consulted ones', () => {
  const consulted = Array.from({length: 25}, (_, i) => ({
    url: `https://protezionecivile.gov.it/page-${i}`,
    title: `Page ${i}`
  }));

  const sources = extractSources({
    output: [
      {type: 'web_search_call', action: {sources: consulted}},
      {
        type: 'message',
        content: [
          {
            annotations: [
              {
                type: 'url_citation',
                url: 'https://meteoam.it/the-one-that-matters',
                title: 'Cited'
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(sources.length <= MAX_SOURCES_SHOWN);
  assert.equal(sources[0].title, 'Cited');
});

test('an untitled source gets a readable label from its URL', () => {
  // Real responses often omit titles for consulted pages; falling back to the
  // bare domain made every chip read the same.
  const [source] = extractSources({
    output: [
      {
        type: 'web_search_call',
        action: {
          sources: [
            {
              url: 'https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/'
            }
          ]
        }
      }
    ]
  });

  assert.equal(source.title, 'Bollettino di criticita');
});

test('responseUsedWebSearch distinguishes a real search from a plain answer', () => {
  assert.equal(responseUsedWebSearch(responseWithSearch), true);
  assert.equal(
    responseUsedWebSearch({ output: [{ type: 'message', content: [] }] }),
    false
  );
  assert.equal(responseUsedWebSearch(null), false);
});

/* ------------------------------------------------------------------ *
 * Location
 * ------------------------------------------------------------------ */

test('user_location is built only from usable coarse fields', () => {
  assert.deepEqual(
    buildUserLocation({ city: 'Napoli', region: 'Campania', country: 'it' }),
    { type: 'approximate', city: 'Napoli', region: 'Campania', country: 'IT' }
  );

  // A non ISO-3166 alpha-2 country is dropped rather than sent as garbage.
  assert.deepEqual(buildUserLocation({ city: 'Napoli', country: 'Italy' }), {
    type: 'approximate',
    city: 'Napoli'
  });

  assert.equal(buildUserLocation(null), null);
  assert.equal(buildUserLocation({}), null);
  assert.equal(buildUserLocation({ timezone: 'Europe/Rome' }), null);
});
