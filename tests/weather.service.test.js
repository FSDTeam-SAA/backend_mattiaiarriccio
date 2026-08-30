import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectWeatherIntent,
  detectWeatherFollowUp,
  parseForecastWindow,
  extractRequestedPlace,
  placeMatchesLocation,
  resolveLocation,
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

test('forecast windows are deterministic in English and Italian', () => {
  assert.deepEqual(parseForecastWindow('What will the weather be like?'), {
    mode: 'rolling',
    hours: 24,
    explicit: false
  });
  assert.deepEqual(parseForecastWindow('over the next 48 hours'), {
    mode: 'rolling',
    hours: 48,
    explicit: true
  });
  assert.equal(
    parseForecastWindow('today and over the next 48 hours').hours,
    48
  );
  assert.equal(parseForecastWindow('nelle prossime 72 ore').hours, 72);
  assert.equal(parseForecastWindow('per i prossimi 2 giorni').hours, 48);
  assert.equal(parseForecastWindow('next 999 hours').hours, 168);
  assert.equal(parseForecastWindow('weather today').mode, 'today');
  assert.equal(parseForecastWindow('meteo domani').mode, 'tomorrow');
  assert.equal(parseForecastWindow('questo fine settimana').mode, 'weekend');
});

test('only concise temporal messages qualify as weather follow-ups', () => {
  assert.equal(detectWeatherFollowUp('and tomorrow?'), true);
  assert.equal(detectWeatherFollowUp('what about the next 48 hours?'), true);
  assert.equal(detectWeatherFollowUp('e per le prossime 24 ore?'), true);
  assert.equal(detectWeatherFollowUp('what should I do today?'), false);
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
  assert.equal(
    extractRequestedPlace('What will the weather in Rome be like over the next 48 hours?'),
    'rome'
  );
  assert.equal(extractRequestedPlace('meteo a Roma nelle prossime 48 ore'), 'roma');
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

const localHoursFrom = (start, count) => {
  const startMs = Date.parse(`${start}Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(startMs + index * 60 * 60_000).toISOString().slice(0, 16)
  );
};

const localDatesFrom = (start, count) => {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(startMs + index * 24 * 60 * 60_000).toISOString().slice(0, 10)
  );
};

const makeForecastResponse = ({
  start = '2026-08-19T00:00',
  hours = 192,
  currentTime = '2026-08-19T14:15',
  currentCode = 95,
  currentFeelsLike = 41.2,
  currentGust = 64.8
} = {}) => {
  const time = localHoursFrom(start, hours);
  const temperature = time.map((_, index) => 28 + (index % 9) * 0.7);
  const apparent = temperature.map((value) => value + 2);
  const codes = Array(hours).fill(2);
  const pops = Array(hours).fill(10);
  const precipitation = Array(hours).fill(0);
  const windSpeed = Array(hours).fill(14);
  const windGust = Array(hours).fill(24);
  const visibility = Array(hours).fill(10_000);
  const isDay = time.map((value) => {
    const hour = Number(value.slice(11, 13));
    return hour >= 6 && hour < 18 ? 1 : 0;
  });

  // The current hour retains the severe measurements used by the original
  // regression, followed by a short storm/rain period.
  const currentIndex = time.indexOf('2026-08-19T14:00');
  if (currentIndex >= 0) {
    temperature[currentIndex] = 33.4;
    apparent[currentIndex] = 41.2;
    codes[currentIndex] = 95;
    pops[currentIndex] = 80;
    precipitation[currentIndex] = 0.4;
    windGust[currentIndex] = 64.8;

    codes[currentIndex + 1] = 95;
    pops[currentIndex + 1] = 75;
    precipitation[currentIndex + 1] = 5.2;
    windGust[currentIndex + 1] = 48;
    codes[currentIndex + 2] = 81;
    pops[currentIndex + 2] = 60;
    precipitation[currentIndex + 2] = 2.5;
  }

  const dates = localDatesFrom('2026-08-19', 7);
  return {
    timezone: 'Asia/Dhaka',
    current: {
      time: currentTime,
      temperature_2m: 33.4,
      apparent_temperature: currentFeelsLike,
      relative_humidity_2m: 78,
      precipitation: 0.4,
      weather_code: currentCode,
      wind_speed_10m: 18.3,
      wind_gusts_10m: currentGust,
      visibility: 8000,
      is_day: 1
    },
    hourly: {
      time,
      temperature_2m: temperature,
      apparent_temperature: apparent,
      weather_code: codes,
      precipitation_probability: pops,
      precipitation,
      wind_speed_10m: windSpeed,
      wind_gusts_10m: windGust,
      visibility,
      is_day: isDay
    },
    daily: {
      time: dates,
      weather_code: [95, 80, 3, 2, 1, 61, 0],
      temperature_2m_max: [33.8, 32.5, 31.9, 32.4, 31.5, 30.9, 32.2],
      temperature_2m_min: [27.1, 26.8, 26.4, 26.9, 26.2, 25.9, 26.3],
      precipitation_probability_max: [80, 55, 20, 10, 5, 60, 0],
      precipitation_sum: [12.4, 5.1, 0, 0, 0, 4.2, 0],
      wind_gusts_10m_max: [64.8, 42, 30, 28, 24, 38, 20],
      sunrise: dates.map((date) => `${date}T05:35`),
      sunset: dates.map((date) => `${date}T18:25`)
    }
  };
};

const forecastResponse = makeForecastResponse();

/** Serves the two upstream endpoints from the fixtures above. */
const stubFetch = (calls = [], weatherResponse = forecastResponse) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('geocoding-api')
      ? geocodeResponse
      : weatherResponse;
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

test('a bare Italian city is preferred over same-named foreign places', async (t) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        results: [
          {
            name: 'Roma',
            admin1: 'Botosani County',
            country: 'Romania',
            country_code: 'RO',
            latitude: 47.83333,
            longitude: 26.6,
            timezone: 'Europe/Bucharest'
          },
          {
            name: 'Roma',
            admin1: 'Lazio',
            country: 'Italia',
            country_code: 'IT',
            latitude: 41.89193,
            longitude: 12.51133,
            timezone: 'Europe/Rome'
          }
        ]
      })
    };
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  const location = await resolveLocation({ city: 'Roma' });

  assert.equal(location.country, 'IT');
  assert.equal(location.region, 'Lazio');
  assert.equal(location.timezone, 'Europe/Rome');
  assert.match(calls[0], /language=it/);
});

test('an explicitly qualified foreign place is not forced into Italy', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      results: [
        {
          name: 'Roma',
          admin1: 'Botosani County',
          country: 'Romania',
          country_code: 'RO',
          latitude: 47.83333,
          longitude: 26.6,
          timezone: 'Europe/Bucharest'
        },
        {
          name: 'Roma',
          admin1: 'Lazio',
          country: 'Italia',
          country_code: 'IT',
          latitude: 41.89193,
          longitude: 12.51133,
          timezone: 'Europe/Rome'
        }
      ]
    })
  });
  t.after(() => {
    globalThis.fetch = original;
  });

  const location = await resolveLocation({ city: 'Roma, Romania' });

  assert.equal(location.country, 'RO');
  assert.equal(location.region, 'Botosani County');
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
  assert.equal(snapshot.hourly.length, 24);
  assert.equal(snapshot.hourly[0].precipitationChance, 80);
  assert.equal(snapshot.daily.length, 7);
  assert.equal(snapshot.daily[0].temperatureMax, 34);
  assert.equal(snapshot.daily[0].temperatureMin, 27);
});

test('an explicit 48-hour request remains complete across day boundaries', async (t) => {
  const restore = stubFetch();
  t.after(restore);

  const snapshot = await getWeatherSnapshot({
    location: { city: 'Dhaka', country: 'BD' },
    language: 'en',
    forecastWindow: parseForecastWindow(
      'What will the weather be like today and over the next 48 hours?'
    )
  });

  assert.equal(snapshot.requestedHours, 48);
  assert.equal(snapshot.availableHours, 48);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.forecastStartsAt, '2026-08-19T14:00');
  assert.equal(snapshot.forecastEndsAt, '2026-08-21T13:00');
  assert.equal(new Set(snapshot.hourly.map((hour) => hour.time.slice(0, 10))).size, 3);
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
