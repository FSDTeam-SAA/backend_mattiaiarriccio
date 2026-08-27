import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectWeatherIntent,
  extractRequestedPlace,
  placeMatchesLocation,
  getWeatherSnapshot,
  formatWeatherContext
} from '../services/weather.service.js';

/* ------------------------------------------------------------------ *
 * Intent
 *
 * The point of a separate weather gate: webSearchTriggers also fires on
 * "alert", "news" and "evacuation", which the approved official domains
 * answer well. Only questions about measurable conditions should pull a
 * forecast, so those must NOT match here.
 * ------------------------------------------------------------------ */

test('questions about measurable conditions match', () => {
  for (const text of [
    'weather in italy',
    'What is the current weather in my area right now?',
    'Is severe weather expected in my area in the next few hours?',
    'will it rain tonight',
    'Qual e il meteo attuale nella mia zona adesso?',
    'quanti gradi ci sono',
    'ci sara vento forte domani?'
  ]) {
    assert.equal(detectWeatherIntent(text), true, text);
  }
});

test('alert and preparedness questions stay on the official-sources path', () => {
  for (const text of [
    'Are there any active official alerts or warnings in my area today?',
    'Ci sono allerte nella mia zona?',
    'What are the latest official civil protection updates for my area?',
    'What should I put in a 72h kit?',
    'How do I treat a burn?',
    'is there an evacuation order'
  ]) {
    assert.equal(detectWeatherIntent(text), false, text);
  }
});

test('a trigger word does not fire inside a longer word', () => {
  // "sole" (it: sun) must not match "consolerai"; "hot" must not match "hotel".
  assert.equal(detectWeatherIntent('where is the nearest hotel'), false);
  assert.equal(detectWeatherIntent('consolerai i feriti'), false);
});

/* ------------------------------------------------------------------ *
 * The place the question names
 *
 * The device's location is the fallback, not the answer: someone in Dhaka
 * asking about Italy must get Italy.
 * ------------------------------------------------------------------ */

test('a place named in the question is picked up', () => {
  assert.equal(extractRequestedPlace('weather in italy'), 'italy');
  assert.equal(extractRequestedPlace('What is the weather in New York?'), 'new york');
  assert.equal(extractRequestedPlace('will it rain in Rome tomorrow'), 'rome');
  assert.equal(extractRequestedPlace('che tempo fa a Milano'), 'milano');
});

test('phrases that only look like places are left to the device location', () => {
  for (const text of [
    'What is the current weather in my area right now?',
    'is it raining here',
    'Qual e il meteo attuale nella mia zona adesso?',
    'will it rain tonight',
    'weather for today',
    'how hot is it in the next hours'
  ]) {
    assert.equal(extractRequestedPlace(text), null, text);
  }
});

/* ------------------------------------------------------------------ *
 * Snapshot building
 *
 * fetch is stubbed with real Open-Meteo response shapes (field names and
 * nesting copied from the documented schema), so the parsing below is
 * verified against the contract the provider actually returns.
 * ------------------------------------------------------------------ */

const geocodeResponse = {
  results: [
    {
      name: 'Dhaka',
      latitude: 23.7104,
      longitude: 90.40744,
      country_code: 'BD',
      country: 'Bangladesh',
      admin1: 'Dhaka Division',
      timezone: 'Asia/Dhaka'
    }
  ]
};

const forecastResponse = {
  timezone: 'Asia/Dhaka',
  current: {
    time: '2026-08-19T14:00',
    temperature_2m: 33.4,
    apparent_temperature: 41.2,
    relative_humidity_2m: 78,
    precipitation: 0.4,
    weather_code: 95,
    wind_speed_10m: 18.3,
    wind_gusts_10m: 64.8,
    visibility: 8000,
    is_day: 1
  },
  hourly: {
    time: [
      '2026-08-19T12:00', '2026-08-19T13:00', '2026-08-19T14:00',
      '2026-08-19T15:00', '2026-08-19T16:00', '2026-08-19T17:00',
      '2026-08-19T18:00', '2026-08-19T19:00'
    ],
    temperature_2m: [32.1, 32.9, 33.4, 33.0, 32.2, 31.4, 30.6, 29.9],
    weather_code: [3, 80, 95, 95, 81, 63, 3, 2],
    precipitation_probability: [20, 45, 80, 75, 60, 40, 20, 10]
  },
  daily: {
    time: ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'],
    weather_code: [95, 80, 3, 2],
    temperature_2m_max: [33.8, 32.5, 31.9, 32.4],
    temperature_2m_min: [27.1, 26.8, 26.4, 26.9],
    precipitation_probability_max: [80, 55, 20, 10],
    precipitation_sum: [12.4, 5.1, 0, 0]
  }
};

/** Serves the two upstream endpoints from the fixtures above. */
const stubFetch = (calls = []) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('geocoding-api')
      ? geocodeResponse
      : forecastResponse;
    return { ok: true, status: 200, statusText: 'OK', json: async () => body };
  };
  return () => {
    globalThis.fetch = original;
  };
};

test('builds a snapshot from a real-shaped provider response', async (t) => {
  const calls = [];
  const restore = stubFetch(calls);
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    // The exact case from the bug report: a user outside Italy, which the
    // approved-domain search could only refuse.
    location: { city: 'Dhaka', country: 'BD', timezone: 'Asia/Dhaka' },
    language: 'en'
  });

  assert.ok(snapshot, 'a location outside Italy must still produce data');
  assert.equal(snapshot.place.name, 'Dhaka');
  assert.equal(snapshot.place.countryCode, 'BD');
  assert.equal(snapshot.current.temperature, 33);
  assert.equal(snapshot.current.feelsLike, 41);
  assert.equal(snapshot.current.condition, 'Thunderstorm');
  assert.equal(snapshot.current.icon, 'thunderstorm');
  assert.equal(snapshot.current.isDay, true);
  assert.equal(snapshot.units.temperature, '°C');

  // Both endpoints were consulted, geocoding first.
  assert.equal(calls.length, 2);
  assert.match(calls[0], /geocoding-api/);
});

test('the city inserted into a current-location prompt keeps the GPS point', () => {
  assert.equal(
    placeMatchesLocation('Apice', {
      city: 'Apice',
      region: 'Campania',
      latitude: 41.1201,
      longitude: 14.9327
    }),
    true
  );
  assert.equal(
    placeMatchesLocation('Naples', { city: 'Apice', region: 'Campania' }),
    false
  );
});

test('device coordinates go straight to the forecast instead of a city centroid', async (t) => {
  const calls = [];
  const restore = stubFetch(calls);
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    location: {
      city: 'Dhaka',
      country: 'BD',
      timezone: 'Asia/Dhaka',
      latitude: 23.81031,
      longitude: 90.41252
    },
    language: 'en'
  });

  assert.ok(snapshot);
  assert.equal(calls.length, 1, 'exact GPS should not be geocoded again');
  assert.match(calls[0], /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(calls[0], /latitude=23\.81031/);
  assert.match(calls[0], /longitude=90\.41252/);
});

test('the hourly strip starts at the current hour, not at midnight', async (t) => {
  const restore = stubFetch();
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    location: { city: 'Dhaka', country: 'BD' },
    language: 'en'
  });

  assert.equal(snapshot.hourly[0].time, '2026-08-19T14:00');
  assert.equal(snapshot.hourly.length, 6);
  assert.equal(snapshot.hourly[0].precipitationChance, 80);
  assert.equal(snapshot.daily.length, 3);
  assert.equal(snapshot.daily[0].temperatureMax, 34);
  assert.equal(snapshot.daily[0].temperatureMin, 27);
});

test('safety flags are derived from the measurements, not from prose', async (t) => {
  const restore = stubFetch();
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    location: { city: 'Dhaka', country: 'BD' },
    language: 'en'
  });

  // 33.4C feeling like 41.2C, code 95, 64.8 km/h gusts.
  assert.deepEqual(
    [...snapshot.safetyFlags].sort(),
    ['extremeHeat', 'strongWind', 'thunderstorm']
  );
});

test('Italian requests get Italian condition labels', async (t) => {
  const restore = stubFetch();
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    location: { city: 'Dhaka', country: 'BD' },
    language: 'it'
  });

  assert.equal(snapshot.current.condition, 'Temporale');
});

test('an upstream failure returns null instead of throwing', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  // A dead provider must cost the user a card, never the answer.
  const snapshot = await getWeatherSnapshot({
    location: { city: 'Bologna', country: 'IT' },
    language: 'en'
  });
  assert.equal(snapshot, null);
});

test('no location means no lookup at all', async () => {
  assert.equal(await getWeatherSnapshot({ location: null }), null);
});

/* ------------------------------------------------------------------ *
 * Model context
 * ------------------------------------------------------------------ */

test('the model context carries the figures and forbids restating them', async (t) => {
  const restore = stubFetch();
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    location: { city: 'Dhaka', country: 'BD' },
    language: 'en'
  });
  const context = formatWeatherContext(snapshot, 'en');

  assert.match(context, /33°C/);
  assert.match(context, /feels like 41°C/);
  assert.match(context, /extreme heat/);
  // The two instructions that stop the answers seen in the bug report.
  assert.match(context, /Do NOT list them again/);
  assert.match(context, /never say you cannot access current weather/);
});

test('no snapshot means no context block', () => {
  assert.equal(formatWeatherContext(null, 'en'), '');
});
