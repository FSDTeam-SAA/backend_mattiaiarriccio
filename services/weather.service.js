/**
 * Real current-conditions data for WeSafe.
 *
 * Why this exists: the live-information path is a web search restricted to the
 * approved official domains (protezionecivile.gov.it, meteoam.it, ...). Those
 * are JS map dashboards and PDF bulletins - excellent for *alerts*, useless for
 * "what is the temperature right now", because there is no readable page with a
 * number on it. The model would therefore find pages, extract nothing, and
 * answer with instructions to go look it up manually; outside Italy it could
 * only refuse. Both are what users were seeing.
 *
 * So current conditions come from a real weather API and the approved domains
 * keep doing what they are actually good for: official alerts.
 *
 * Open-Meteo needs no API key, covers the whole globe (Italy and Dhaka alike),
 * and returns numbers rather than prose. Swapping providers means reimplementing
 * only `fetchForecast` / `geocodePlace` - the snapshot shape below is the
 * contract the controller and the app depend on.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** A weather lookup must never out-wait the user's patience for an answer. */
const REQUEST_TIMEOUT_MS = 6000;

/** Conditions do not meaningfully change minute to minute, and neither do the
 *  coordinates of a city. Both caches spare the provider a burst of identical
 *  calls when a user sends several messages in a row. */
const FORECAST_TTL_MS = 10 * 60_000;
const GEOCODE_TTL_MS = 24 * 60 * 60_000;

const forecastCache = new Map();
const geocodeCache = new Map();

const readCache = (cache, key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

const writeCache = (cache, key, value, ttl) => {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  // Unbounded growth would be a slow leak in a long-running process.
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const getJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/* ------------------------------------------------------------------ *
 * 1. Intent
 * ------------------------------------------------------------------ */

/**
 * Weather-specific triggers, deliberately narrower than webSearchTriggers.
 *
 * That list also fires on "alert", "news" and "evacuation", which are questions
 * the approved official domains answer well. Only the subset that asks for
 * measurable conditions should pull a forecast.
 */
const WEATHER_TERMS = [
  // en
  'weather', 'forecast', 'temperature', 'temperatures', 'rain', 'raining',
  'rainfall', 'storm', 'storms', 'thunderstorm', 'snow', 'snowing', 'wind',
  'windy', 'humidity', 'hot', 'cold', 'heatwave', 'hail', 'fog', 'sunny',
  'cloudy', 'degrees', 'umbrella',
  // it
  'meteo', 'previsioni', 'temperatura', 'temperature', 'pioggia', 'piove',
  'temporale', 'temporali', 'neve', 'nevica', 'vento', 'ventoso', 'umidita',
  'caldo', 'freddo', 'grandine', 'nebbia', 'sole', 'nuvoloso', 'gradi',
  'maltempo', 'ombrello'
];

const normalizeForMatch = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True when the message is asking about measurable weather conditions. */
export const detectWeatherIntent = (text) => {
  const haystack = normalizeForMatch(text);
  if (!haystack) return false;
  const words = new Set(haystack.split(' '));
  return WEATHER_TERMS.some((term) => words.has(term));
};

/**
 * Places the question names itself, e.g. "weather in Italy" from a phone in
 * Dhaka.
 *
 * Without this the only place we know is the device's, so a question about
 * somewhere else is answered with the conditions where the user is standing -
 * quietly wrong, which is worse than no card at all. The capture is
 * deliberately shallow: whatever it returns is handed to the geocoder, and a
 * phrase that is not a place simply fails to resolve and we fall back to the
 * device location.
 */
const PLACE_PREPOSITIONS = ['in', 'at', 'for', 'near', 'around', 'a', 'su', 'per', 'sul', 'sulla'];

/** Words that follow a preposition without ever naming a place: "in my area",
 *  "for tonight", "nella mia zona". Capturing these would send junk to the
 *  geocoder and, worse, occasionally resolve to a real town of that name. */
const NOT_A_PLACE = new Set([
  'my', 'the', 'this', 'that', 'these', 'our', 'your', 'his', 'her', 'their',
  'here', 'there', 'me', 'us', 'area', 'zone', 'region', 'city', 'town',
  'home', 'house', 'work', 'now', 'today', 'tonight', 'tomorrow', 'morning',
  'afternoon', 'evening', 'night', 'next', 'coming', 'hours', 'days', 'week',
  'weekend', 'general',
  'mia', 'mio', 'miei', 'mie', 'nostra', 'nostro', 'questa', 'questo', 'quella',
  'zona', 'citta', 'paese', 'casa', 'qui', 'qua', 'oggi', 'stasera', 'domani',
  'mattina', 'pomeriggio', 'sera', 'notte', 'prossime', 'prossimi', 'ore',
  'giorni', 'settimana', 'giro', 'me'
]);

/** Words that end a place name rather than belong to it: "weather in Rome
 *  tomorrow" must geocode "Rome", not "Rome tomorrow". */
const PLACE_TERMINATORS = new Set([
  ...NOT_A_PLACE,
  'and', 'or', 'right', 'currently', 'please', 'is', 'are', 'will', 'e', 'o',
  'adesso', 'ora', 'attuale', 'attualmente'
]);

export const extractRequestedPlace = (text) => {
  const words = normalizeForMatch(text).split(' ').filter(Boolean);

  for (let i = 0; i < words.length - 1; i += 1) {
    if (!PLACE_PREPOSITIONS.includes(words[i])) continue;

    const parts = [];
    for (let j = i + 1; j < words.length && parts.length < 3; j += 1) {
      const word = words[j];
      if (parts.length === 0 && NOT_A_PLACE.has(word)) break;
      if (parts.length > 0 && PLACE_TERMINATORS.has(word)) break;
      // A weather word after the preposition means the sentence moved on
      // ("in the forecast"), not that the place is called "rain".
      if (WEATHER_TERMS.includes(word)) break;
      parts.push(word);
    }

    if (parts.length > 0) return parts.join(' ');
  }

  return null;
};

/**
 * True when the place parsed from the sentence is the same place supplied by
 * the device. Dedicated Weather prompts include the reverse-geocoded city in
 * their text; recognising it here preserves the accompanying GPS point instead
 * of geocoding that city back to its approximate centre.
 */
export const placeMatchesLocation = (requestedPlace, location) => {
  const requested = normalizeForMatch(requestedPlace);
  if (!requested || !location) return false;

  return [location.city, location.region]
    .map(normalizeForMatch)
    .filter(Boolean)
    .some((candidate) => candidate === requested);
};

/* ------------------------------------------------------------------ *
 * 2. WMO code -> human condition
 * ------------------------------------------------------------------ */

/**
 * `icon` is a stable key the app maps to its own artwork, so the two ends never
 * have to agree on a font or an emoji set.
 */
const WEATHER_CODES = {
  0: { icon: 'clear', en: 'Clear sky', it: 'Cielo sereno' },
  1: { icon: 'mostly_clear', en: 'Mainly clear', it: 'Prevalentemente sereno' },
  2: { icon: 'partly_cloudy', en: 'Partly cloudy', it: 'Parzialmente nuvoloso' },
  3: { icon: 'cloudy', en: 'Overcast', it: 'Coperto' },
  45: { icon: 'fog', en: 'Fog', it: 'Nebbia' },
  48: { icon: 'fog', en: 'Freezing fog', it: 'Nebbia gelata' },
  51: { icon: 'drizzle', en: 'Light drizzle', it: 'Pioviggine leggera' },
  53: { icon: 'drizzle', en: 'Drizzle', it: 'Pioviggine' },
  55: { icon: 'drizzle', en: 'Heavy drizzle', it: 'Pioviggine intensa' },
  56: { icon: 'sleet', en: 'Freezing drizzle', it: 'Pioviggine gelata' },
  57: { icon: 'sleet', en: 'Heavy freezing drizzle', it: 'Pioviggine gelata intensa' },
  61: { icon: 'rain', en: 'Light rain', it: 'Pioggia debole' },
  63: { icon: 'rain', en: 'Rain', it: 'Pioggia' },
  65: { icon: 'heavy_rain', en: 'Heavy rain', it: 'Pioggia forte' },
  66: { icon: 'sleet', en: 'Freezing rain', it: 'Pioggia gelata' },
  67: { icon: 'sleet', en: 'Heavy freezing rain', it: 'Pioggia gelata forte' },
  71: { icon: 'snow', en: 'Light snow', it: 'Neve debole' },
  73: { icon: 'snow', en: 'Snow', it: 'Neve' },
  75: { icon: 'heavy_snow', en: 'Heavy snow', it: 'Neve abbondante' },
  77: { icon: 'snow', en: 'Snow grains', it: 'Granelli di neve' },
  80: { icon: 'showers', en: 'Light showers', it: 'Rovesci leggeri' },
  81: { icon: 'showers', en: 'Showers', it: 'Rovesci' },
  82: { icon: 'heavy_rain', en: 'Violent showers', it: 'Rovesci violenti' },
  85: { icon: 'snow', en: 'Snow showers', it: 'Rovesci di neve' },
  86: { icon: 'heavy_snow', en: 'Heavy snow showers', it: 'Rovesci di neve intensi' },
  95: { icon: 'thunderstorm', en: 'Thunderstorm', it: 'Temporale' },
  96: { icon: 'hail', en: 'Thunderstorm with hail', it: 'Temporale con grandine' },
  99: { icon: 'hail', en: 'Thunderstorm with heavy hail', it: 'Temporale con forte grandine' }
};

const describeCode = (code, lang) => {
  const entry = WEATHER_CODES[code];
  if (!entry) {
    return { icon: 'unknown', label: lang === 'it' ? 'Non disponibile' : 'Not available' };
  }
  return { icon: entry.icon, label: entry[lang] || entry.en };
};

/* ------------------------------------------------------------------ *
 * 3. Safety flags
 * ------------------------------------------------------------------ */

/**
 * The bridge between a forecast and WeSafe's actual job.
 *
 * A temperature reading is not safety guidance; these flags are what let the
 * assistant say something useful and specific ("gusts to 74 km/h - secure
 * balcony furniture") instead of generic filler. Thresholds are conservative on
 * purpose: a flag drives advice, never an alarm - official alerts still come
 * from the approved civil-protection sources.
 */
const buildSafetyFlags = ({ code, temperature, apparent, windGust, windSpeed, precipitation, visibility }) => {
  const flags = [];
  const gust = Number.isFinite(windGust) ? windGust : windSpeed;

  if (code >= 95) flags.push('thunderstorm');
  if (code === 65 || code === 82 || (Number.isFinite(precipitation) && precipitation >= 4))
    flags.push('heavyRain');
  if ([71, 73, 75, 77, 85, 86, 56, 57, 66, 67].includes(code)) flags.push('snowIce');
  if (Number.isFinite(gust) && gust >= 60) flags.push('strongWind');
  if (Number.isFinite(apparent) && apparent >= 35) flags.push('extremeHeat');
  if (Number.isFinite(apparent) && apparent <= -5) flags.push('extremeCold');
  else if (Number.isFinite(temperature) && temperature <= 0) flags.push('freezing');
  if (code === 45 || code === 48 || (Number.isFinite(visibility) && visibility < 1000))
    flags.push('lowVisibility');

  return flags;
};

/* ------------------------------------------------------------------ *
 * 4. Geocoding
 * ------------------------------------------------------------------ */

const round = (value, decimals = 0) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Turns a named city/region/country into coordinates. Device-location requests
 * can already carry a validated GPS point and bypass this lossy round trip;
 * typed place names still use the geocoder.
 */
const geocodePlace = async ({ city, region, country }) => {
  const name = String(city || region || country || '').trim();
  if (!name) return null;

  const cacheKey = `${name}|${country || ''}`.toLowerCase();
  const cached = readCache(geocodeCache, cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    name,
    count: '10',
    language: 'en',
    format: 'json'
  });

  const data = await getJson(`${GEOCODE_URL}?${params.toString()}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return null;

  // Prefer a hit in the country the device reported: "Springfield" and even
  // "Valencia" exist in several countries, and the wrong one is worse than none.
  const wantedCountry = String(country || '').trim().toUpperCase();
  const match =
    (wantedCountry.length === 2
      ? results.find((item) => String(item.country_code || '').toUpperCase() === wantedCountry)
      : null) || results[0];

  const place = {
    name: match.name || name,
    region: match.admin1 || String(region || ''),
    country: match.country || String(country || ''),
    countryCode: String(match.country_code || country || '').toUpperCase(),
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone || ''
  };

  writeCache(geocodeCache, cacheKey, place, GEOCODE_TTL_MS);
  return place;
};

/* ------------------------------------------------------------------ *
 * 5. Forecast
 * ------------------------------------------------------------------ */

const fetchForecast = async ({ latitude, longitude, timezone }) => {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,' +
      'weather_code,wind_speed_10m,wind_gusts_10m,visibility,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,' +
      'precipitation_probability_max,precipitation_sum',
    timezone: timezone || 'auto',
    forecast_days: '4'
  });

  return getJson(`${FORECAST_URL}?${params.toString()}`);
};

/**
 * The next few hours, starting from the current hour rather than from midnight.
 *
 * Open-Meteo returns the whole day from 00:00 in the location's own timezone, so
 * without this the app would show a strip that begins in the past.
 */
const buildHourly = (data, lang, limit = 6) => {
  const times = data?.hourly?.time || [];
  const temps = data?.hourly?.temperature_2m || [];
  const codes = data?.hourly?.weather_code || [];
  const pops = data?.hourly?.precipitation_probability || [];
  if (times.length === 0) return [];

  const nowIso = String(data?.current?.time || '');
  let start = times.findIndex((time) => String(time) >= nowIso);
  if (start === -1) start = 0;

  const out = [];
  for (let i = start; i < times.length && out.length < limit; i += 1) {
    const { icon, label } = describeCode(codes[i], lang);
    out.push({
      time: times[i],
      temperature: round(temps[i]),
      weatherCode: codes[i] ?? null,
      icon,
      condition: label,
      precipitationChance: round(pops[i])
    });
  }
  return out;
};

const buildDaily = (data, lang, limit = 3) => {
  const dates = data?.daily?.time || [];
  const codes = data?.daily?.weather_code || [];
  const maxes = data?.daily?.temperature_2m_max || [];
  const mins = data?.daily?.temperature_2m_min || [];
  const pops = data?.daily?.precipitation_probability_max || [];

  const out = [];
  for (let i = 0; i < dates.length && out.length < limit; i += 1) {
    const { icon, label } = describeCode(codes[i], lang);
    out.push({
      date: dates[i],
      weatherCode: codes[i] ?? null,
      icon,
      condition: label,
      temperatureMax: round(maxes[i]),
      temperatureMin: round(mins[i]),
      precipitationChance: round(pops[i])
    });
  }
  return out;
};

/**
 * The one entry point the chat controller uses.
 *
 * Returns null on every failure rather than throwing: a missing forecast must
 * cost the user a card, never the answer. The caller distinguishes "could not
 * look it up" from "do not know where you are" via `location` being absent
 * before it ever calls in here.
 *
 * @returns {Promise<object|null>} snapshot consumed by the app's weather card
 */
export const getWeatherSnapshot = async ({ location, language = 'en' } = {}) => {
  const lang = String(language).startsWith('it') ? 'it' : 'en';
  if (!location) return null;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasExactPoint =
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;

  const cacheKey = [
    hasExactPoint ? latitude.toFixed(4) : '',
    hasExactPoint ? longitude.toFixed(4) : '',
    String(location.city || '').toLowerCase(),
    String(location.region || '').toLowerCase(),
    String(location.country || '').toLowerCase(),
    lang
  ].join('|');

  const cached = readCache(forecastCache, cacheKey);
  if (cached) return cached;

  try {
    // Use the phone's measured point for weather. Web Search still receives
    // only city/region/country through buildUserLocation(), because OpenAI's
    // search location contract is intentionally approximate.
    const place = hasExactPoint
      ? {
          name:
            String(location.city || location.region || '').trim() ||
            (lang === 'it' ? 'Posizione attuale' : 'Current location'),
          region: String(location.region || ''),
          country: String(location.country || ''),
          countryCode: String(location.country || '').toUpperCase(),
          latitude,
          longitude,
          timezone: String(location.timezone || '')
        }
      : await geocodePlace(location);
    if (!place) {
      console.warn(
        `[weather.service] no coordinates for "${location.city || location.region || location.country}"`
      );
      return null;
    }

    const data = await fetchForecast({
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: location.timezone || place.timezone
    });

    const current = data?.current;
    if (!current || !Number.isFinite(current.temperature_2m)) {
      console.warn('[weather.service] forecast response carried no current conditions');
      return null;
    }

    const code = Number(current.weather_code);
    const { icon, label } = describeCode(code, lang);

    const snapshot = {
      provider: 'open-meteo',
      place: {
        name: place.name,
        region: place.region,
        country: place.country,
        countryCode: place.countryCode
      },
      observedAt: current.time || new Date().toISOString(),
      timezone: data?.timezone || place.timezone || '',
      units: { temperature: '°C', wind: 'km/h', precipitation: 'mm' },
      current: {
        temperature: round(current.temperature_2m),
        feelsLike: round(current.apparent_temperature),
        humidity: round(current.relative_humidity_2m),
        precipitation: round(current.precipitation, 1),
        windSpeed: round(current.wind_speed_10m),
        windGust: round(current.wind_gusts_10m),
        weatherCode: Number.isFinite(code) ? code : null,
        icon,
        condition: label,
        isDay: current.is_day !== 0
      },
      hourly: buildHourly(data, lang),
      daily: buildDaily(data, lang),
      safetyFlags: buildSafetyFlags({
        code,
        temperature: current.temperature_2m,
        apparent: current.apparent_temperature,
        windGust: current.wind_gusts_10m,
        windSpeed: current.wind_speed_10m,
        precipitation: current.precipitation,
        visibility: current.visibility
      })
    };

    writeCache(forecastCache, cacheKey, snapshot, FORECAST_TTL_MS);
    return snapshot;
  } catch (error) {
    console.error(
      '[weather.service] lookup failed:',
      error?.name === 'AbortError'
        ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
        : error?.message || error
    );
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * 6. Model context
 * ------------------------------------------------------------------ */

const FLAG_NOTES = {
  en: {
    thunderstorm: 'thunderstorm activity',
    heavyRain: 'heavy rainfall (flash-flood and aquaplaning risk)',
    snowIce: 'snow or ice (slippery roads and pavements)',
    strongWind: 'strong wind gusts (falling branches, loose objects)',
    extremeHeat: 'extreme heat (heatstroke and dehydration risk)',
    extremeCold: 'extreme cold (hypothermia risk)',
    freezing: 'sub-zero temperatures (black ice)',
    lowVisibility: 'very low visibility'
  },
  it: {
    thunderstorm: 'attivita temporalesca',
    heavyRain: 'pioggia intensa (rischio allagamenti lampo e aquaplaning)',
    snowIce: 'neve o ghiaccio (strade e marciapiedi scivolosi)',
    strongWind: 'forti raffiche di vento (rami e oggetti che possono cadere)',
    extremeHeat: 'caldo estremo (rischio colpo di calore e disidratazione)',
    extremeCold: 'freddo estremo (rischio ipotermia)',
    freezing: 'temperature sotto zero (ghiaccio nero)',
    lowVisibility: 'visibilita molto ridotta'
  }
};

/**
 * The measured facts, handed to the model as context.
 *
 * This block is why the assistant can stop hedging: it is no longer guessing at
 * conditions it could not read off a bulletin page, so it can spend its whole
 * answer on safety advice. The instruction not to repeat the numbers matters -
 * the app renders them as a card directly above the text, and an answer that
 * restates them is the wall of prose this whole change is replacing.
 */
export const formatWeatherContext = (snapshot, language = 'en') => {
  if (!snapshot) return '';
  const lang = String(language).startsWith('it') ? 'it' : 'en';
  const { place, current, daily, safetyFlags } = snapshot;

  const where = [place.name, place.region, place.country]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ');

  const lines = [
    `MEASURED WEATHER DATA for ${where} (source: Open-Meteo, observed ${snapshot.observedAt}):`,
    `- Condition: ${current.condition}`,
    `- Temperature: ${current.temperature}°C (feels like ${current.feelsLike}°C)`,
    `- Wind: ${current.windSpeed} km/h, gusts ${current.windGust} km/h`,
    `- Humidity: ${current.humidity}%`,
    `- Precipitation now: ${current.precipitation} mm`
  ];

  if (daily?.length) {
    const today = daily[0];
    lines.push(
      `- Today: ${today.condition}, ${today.temperatureMin}°C to ${today.temperatureMax}°C, ` +
        `${today.precipitationChance}% chance of precipitation`
    );
  }

  const notes = FLAG_NOTES[lang] || FLAG_NOTES.en;
  if (safetyFlags?.length) {
    lines.push(
      `- Safety-relevant conditions: ${safetyFlags
        .map((flag) => notes[flag] || flag)
        .join('; ')}`
    );
  } else {
    lines.push('- Safety-relevant conditions: none, conditions are ordinary.');
  }

  lines.push(
    '',
    'HOW TO USE THIS DATA:',
    '- These figures are verified. State them as fact; never say you cannot access current weather.',
    '- The app already shows these numbers in a weather card directly above your text. Do NOT list them again.',
    '- Write 2-4 short lines of safety advice specific to the conditions above, and nothing else.',
    '- Never tell the user to go and check a weather site for the current conditions - they already have them.',
    '- If an official alert is active for this area, say so briefly; otherwise do not invent one.'
  );

  return lines.join('\n');
};
