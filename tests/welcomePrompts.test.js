import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LIVE_INFO_BUTTONS,
  DEFAULT_SUGGESTED_QUESTIONS
} from '../services/webSearchSeed.service.js';
import { LOCATION_PLACEHOLDER } from '../models/liveInfoSuggestion.model.js';
import { DEFAULT_SETTINGS } from '../services/settings.service.js';
import { matchesTriggers } from '../services/webSearch.service.js';

const LANGUAGES = ['en', 'it'];

const buttonsFor = (language) =>
  DEFAULT_LIVE_INFO_BUTTONS.filter((entry) => entry.language === language);

test('both languages get the same four Live Information buttons', () => {
  for (const language of LANGUAGES) {
    const buttons = buttonsFor(language);
    assert.equal(
      buttons.length,
      4,
      `${language} should have exactly four buttons`
    );
    assert.deepEqual(
      buttons.map((entry) => entry.order).sort(),
      [0, 1, 2, 3],
      `${language} buttons should be ordered 0-3`
    );
  }

  assert.deepEqual(
    buttonsFor('en').map((entry) => entry.requiresLocation),
    buttonsFor('it').map((entry) => entry.requiresLocation),
    'the two languages must agree on which buttons ask for a location'
  );
});

test('a button that asks for a location says where the place goes', () => {
  for (const entry of DEFAULT_LIVE_INFO_BUTTONS) {
    if (entry.requiresLocation) {
      assert.ok(
        entry.prompt.includes(LOCATION_PLACEHOLDER),
        `"${entry.title}" asks for a location but has no ${LOCATION_PLACEHOLDER}`
      );
    } else {
      assert.ok(
        !entry.prompt.includes(LOCATION_PLACEHOLDER),
        `"${entry.title}" never asks for a location, so ${LOCATION_PLACEHOLDER} would never be filled`
      );
    }
  }
});

// The cost gate is the whole reason a search is ever offered. A shortcut whose
// prompt misses every trigger word is a button that silently answers from
// memory - the exact failure the live-search indicator exists to expose.
test('every Live Information button opens the live path', () => {
  for (const entry of DEFAULT_LIVE_INFO_BUTTONS) {
    const prompt = entry.prompt.replace(LOCATION_PLACEHOLDER, 'Naples');
    assert.ok(
      matchesTriggers(prompt, DEFAULT_SETTINGS.webSearchTriggers[entry.language]),
      `"${entry.title}" (${entry.language}) matches no trigger keyword`
    );
  }
});

test('suggested questions are a mix of live and offline questions', () => {
  for (const language of LANGUAGES) {
    const questions = DEFAULT_SUGGESTED_QUESTIONS.filter(
      (entry) => entry.language === language
    );
    assert.ok(questions.length >= 4, `${language} needs a real list`);

    const triggers = DEFAULT_SETTINGS.webSearchTriggers[language];
    const live = questions.filter((entry) =>
      matchesTriggers(entry.prompt, triggers)
    );

    assert.ok(
      live.length > 0,
      `${language} has no question that reaches a live search`
    );
    assert.ok(
      live.length < questions.length,
      `${language} has no question WeSafe answers from its own guidance`
    );
  }
});

test('seismic questions reach the live path in both languages', () => {
  const cases = [
    ['Have there been any earthquakes near me recently?', 'en'],
    ['What was the magnitude of the last quake?', 'en'],
    ['Ci sono stati terremoti vicino a me?', 'it'],
    ['Che magnitudo aveva la scossa di oggi?', 'it']
  ];

  for (const [message, language] of cases) {
    assert.ok(
      matchesTriggers(message, DEFAULT_SETTINGS.webSearchTriggers[language]),
      `"${message}" should open the live path`
    );
  }
});

test('the web search prompt forbids predicting earthquakes', () => {
  const { en, it } = DEFAULT_SETTINGS.webSearchPrompt;
  assert.match(en, /NEVER predict an earthquake/);
  assert.match(en, /cannot be predicted/);
  assert.match(it, /Non prevedere MAI un terremoto/);
  assert.match(it, /non si possono prevedere/);
});
