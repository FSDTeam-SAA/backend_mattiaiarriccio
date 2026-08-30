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

/**
 * One week is the largest rolling window exposed by chat. Fetching that one
 * reusable horizon lets a cached 24-hour answer satisfy a later 48-hour
 * question without another provider call or, worse, returning the short
 * projection from cache.
 */
const DEFAULT_FORECAST_HOURS = 24;
const MAX_FORECAST_HOURS = 168;
const DAILY_FORECAST_DAYS = 7;

// Raw provider responses are cached, never request-specific snapshots.
const forecastCache = new Map();
const geocodeCache = new Map();

const hasUsableCoordinates = (location) => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
};

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
  'and', 'or', 'right', 'currently', 'please', 'is', 'are', 'will', 'be', 'like',
  'for', 'over', 'during', 'through', 'until', 'from', 'e', 'o', 'nelle', 'nella',
  'nel', 'nei', 'durante', 'fino', 'adesso', 'ora', 'attuale', 'attualmente'
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

/* ------------------------------------------------------------------ *
 * 1a. Requested forecast window
 * ------------------------------------------------------------------ */

const HOUR_UNITS = '(?:h|hr|hrs|hour|hours|ora|ore)';
const DAY_UNITS = '(?:d|day|days|giorno|giorni)';

const clampForecastHours = (value) =>
  Math.min(MAX_FORECAST_HOURS, Math.max(1, Math.trunc(value)));

/**
 * Converts the user's wording into a deterministic projection instruction.
 * Calendar windows are resolved only after the provider tells us the place's
 * local date; rolling windows can be resolved immediately.
 */
export const parseForecastWindow = (text) => {
  const normalized = normalizeForMatch(text);

  const hourMatch = normalized.match(
    new RegExp(`\\b(\\d{1,4})\\s*${HOUR_UNITS}\\b`, 'u')
  );
  if (hourMatch) {
    return {
      mode: 'rolling',
      hours: clampForecastHours(Number(hourMatch[1]) || DEFAULT_FORECAST_HOURS),
      explicit: true
    };
  }

  const dayMatch = normalized.match(
    new RegExp(`\\b(\\d{1,4})\\s*${DAY_UNITS}\\b`, 'u')
  );
  if (dayMatch) {
    return {
      mode: 'rolling',
      hours: clampForecastHours((Number(dayMatch[1]) || 1) * 24),
      explicit: true
    };
  }

  if (/\b(tomorrow|domani)\b/u.test(normalized)) {
    return { mode: 'tomorrow', hours: 24, explicit: true };
  }
  if (/\b(weekend|fine settimana)\b/u.test(normalized)) {
    return { mode: 'weekend', hours: 48, explicit: true };
  }
  if (/\b(today|tonight|oggi|stasera)\b/u.test(normalized)) {
    return { mode: 'today', hours: DEFAULT_FORECAST_HOURS, explicit: true };
  }

  return {
    mode: 'rolling',
    hours: DEFAULT_FORECAST_HOURS,
    explicit: false
  };
};

/** Conservative conversational continuation: "and tomorrow?" should reuse
 * the previous weather card, while an unrelated "what should I do today?"
 * must not silently become a forecast request. */
export const detectWeatherFollowUp = (text) => {
  const normalized = normalizeForMatch(text);
  const window = parseForecastWindow(text);
  if (!normalized || !window.explicit) return false;

  const allowed = new Set([
    'and', 'or', 'what', 'how', 'about', 'then', 'for', 'the', 'next', 'over',
    'later', 'please', 'will', 'it', 'be', 'like', 'today', 'tonight',
    'tomorrow', 'weekend', 'hours', 'hour', 'hrs', 'hr', 'h', 'days', 'day', 'd',
    'e', 'o', 'che', 'come', 'invece', 'poi', 'per', 'il', 'la', 'le', 'i',
    'prossime', 'prossimi', 'prossima', 'prossimo', 'ore', 'ora', 'giorni',
    'giorno', 'oggi', 'stasera', 'domani', 'fine', 'settimana'
  ]);

  return normalized
    .split(' ')
    .every((word) => /^\d{1,4}$/u.test(word) || allowed.has(word));
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
    // Open-Meteo searches translated place names. Using Italian is important
    // here: its English index does not return Rome for "Roma" or Milan for
    // "Milano", and used to leave similarly named foreign towns at the top.
    language: 'it',
    format: 'json'
  });

  const data = await getJson(`${GEOCODE_URL}?${params.toString()}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return null;

  // Prefer a hit in the country the device reported. For a bare manually typed
  // name, prefer Italy because WeSafe is initially aimed at Italian users.
  // A comma means the user qualified the place themselves ("Roma, Romania"),
  // in which case the provider's ranked result wins instead.
  const wantedCountry = String(country || '').trim().toUpperCase();
  const explicitlyQualified = /[,;/]/.test(name);
  const match =
    (wantedCountry.length === 2
      ? results.find((item) => String(item.country_code || '').toUpperCase() === wantedCountry)
      : null) ||
    (!wantedCountry && !explicitlyQualified
      ? results.find((item) => String(item.country_code || '').toUpperCase() === 'IT')
      : null) ||
    results[0];

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

/**
 * Canonicalizes one location before either weather or Web Search uses it.
 *
 * GPS locations already identify one exact point and are kept intact. Named
 * locations are geocoded once into the same city/region/country/coordinates,
 * preventing the weather card from showing one place while Web Search is
 * biased toward another. Failure remains non-fatal: callers can keep using the
 * original coarse input and still produce an answer.
 */
export const resolveLocation = async (location) => {
  if (!location) return null;
  if (hasUsableCoordinates(location)) return { ...location };

  try {
    const place = await geocodePlace(location);
    if (!place) return null;

    return {
      city: place.name,
      region: place.region,
      country: place.countryCode,
      timezone: String(location.timezone || place.timezone || ''),
      latitude: place.latitude,
      longitude: place.longitude
    };
  } catch (error) {
    console.warn(
      '[weather.service] location resolution failed:',
      error?.name === 'AbortError'
        ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
        : error?.message || error
    );
    return null;
  }
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
    hourly:
      'temperature_2m,apparent_temperature,weather_code,precipitation_probability,' +
      'precipitation,wind_speed_10m,wind_gusts_10m,visibility,is_day',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,' +
      'precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,' +
      'sunrise,sunset',
    timezone: timezone || 'auto',
    // `forecast_hours` is relative to the current hour. Unlike forecast_days,
    // it does not make callers discard the already elapsed part of today.
    forecast_hours: String(MAX_FORECAST_HOURS),
    forecast_days: String(DAILY_FORECAST_DAYS)
  });

  return getJson(`${FORECAST_URL}?${params.toString()}`);
};

const localHourIso = (value) => {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2}T\d{2})/u);
  return match ? `${match[1]}:00` : '';
};

const localDate = (value) => String(value || '').slice(0, 10);

const addLocalDays = (date, amount) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
};

const weekdayForLocalDate = (date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay();
};

/** Normalize every usable provider timestep once. Projection happens later. */
const buildHourly = (data, lang) => {
  const times = data?.hourly?.time || [];
  const temps = data?.hourly?.temperature_2m || [];
  const apparent = data?.hourly?.apparent_temperature || [];
  const codes = data?.hourly?.weather_code || [];
  const pops = data?.hourly?.precipitation_probability || [];
  const precipitation = data?.hourly?.precipitation || [];
  const windSpeeds = data?.hourly?.wind_speed_10m || [];
  const windGusts = data?.hourly?.wind_gusts_10m || [];
  const visibility = data?.hourly?.visibility || [];
  const isDay = data?.hourly?.is_day || [];
  if (times.length === 0) return [];

  // Current observations can be timestamped at :15/:30/:45. Compare their
  // containing hour, not the exact minute, so the current hourly timestep is
  // not accidentally skipped.
  const nowHour = localHourIso(data?.current?.time);
  const start = nowHour
    ? times.findIndex((time) => localHourIso(time) >= nowHour)
    : 0;
  if (start === -1) return [];

  const out = [];
  for (
    let i = Math.max(0, start);
    i < times.length && out.length < MAX_FORECAST_HOURS;
    i += 1
  ) {
    if (!String(times[i] || '').trim() || !Number.isFinite(temps[i])) continue;

    const code = Number(codes[i]);
    const { icon, label } = describeCode(code, lang);
    const flags = buildSafetyFlags({
      code,
      temperature: temps[i],
      apparent: apparent[i],
      windGust: windGusts[i],
      windSpeed: windSpeeds[i],
      precipitation: precipitation[i],
      visibility: visibility[i]
    });

    out.push({
      time: times[i],
      temperature: round(temps[i]),
      feelsLike: round(apparent[i]),
      weatherCode: Number.isFinite(code) ? code : null,
      icon,
      condition: label,
      precipitationChance: round(pops[i]),
      precipitation: round(precipitation[i], 1),
      windSpeed: round(windSpeeds[i]),
      windGust: round(windGusts[i]),
      visibility: round(visibility[i]),
      isDay: isDay[i] !== 0,
      safetyFlags: flags
    });
  }
  return out;
};

const resolveForecastProjection = (hours, currentTime, requestedWindow) => {
  const window = requestedWindow || parseForecastWindow('');
  const firstTime = hours[0]?.time || '';
  const reference = localHourIso(currentTime) || localHourIso(firstTime);
  const date = localDate(reference);
  const hourOfDay = Number(reference.slice(11, 13));

  if (window.mode === 'today' && date) {
    const requestedHours = Number.isFinite(hourOfDay)
      ? Math.max(1, 24 - hourOfDay)
      : DEFAULT_FORECAST_HOURS;
    return {
      requestedHours,
      hours: hours.filter((hour) => localDate(hour.time) === date)
    };
  }

  if (window.mode === 'tomorrow' && date) {
    const tomorrow = addLocalDays(date, 1);
    return {
      requestedHours: 24,
      hours: hours.filter((hour) => localDate(hour.time) === tomorrow)
    };
  }

  if (window.mode === 'weekend' && date) {
    const weekday = weekdayForLocalDate(date);
    if (weekday !== null) {
      const daysUntilSaturday = weekday === 0 ? -1 : (6 - weekday + 7) % 7;
      const targetDates =
        weekday === 0
          ? [date]
          : [
              addLocalDays(date, daysUntilSaturday),
              addLocalDays(date, daysUntilSaturday + 1)
            ];
      const remainingToday = Number.isFinite(hourOfDay)
        ? Math.max(1, 24 - hourOfDay)
        : 24;
      const requestedHours = weekday === 0
        ? remainingToday
        : weekday === 6
          ? remainingToday + 24
          : 48;

      return {
        requestedHours,
        hours: hours.filter((hour) => targetDates.includes(localDate(hour.time)))
      };
    }
  }

  const requestedHours = clampForecastHours(
    Number(window.hours) || DEFAULT_FORECAST_HOURS
  );
  return { requestedHours, hours: hours.slice(0, requestedHours) };
};

const buildDaily = (data, lang, limit = DAILY_FORECAST_DAYS) => {
  const dates = data?.daily?.time || [];
  const codes = data?.daily?.weather_code || [];
  const maxes = data?.daily?.temperature_2m_max || [];
  const mins = data?.daily?.temperature_2m_min || [];
  const pops = data?.daily?.precipitation_probability_max || [];
  const precipitation = data?.daily?.precipitation_sum || [];
  const gusts = data?.daily?.wind_gusts_10m_max || [];
  const sunrises = data?.daily?.sunrise || [];
  const sunsets = data?.daily?.sunset || [];

  const out = [];
  for (let i = 0; i < dates.length && out.length < limit; i += 1) {
    const code = Number(codes[i]);
    const { icon, label } = describeCode(code, lang);
    out.push({
      date: dates[i],
      weatherCode: Number.isFinite(code) ? code : null,
      icon,
      condition: label,
      temperatureMax: round(maxes[i]),
      temperatureMin: round(mins[i]),
      precipitationChance: round(pops[i]),
      precipitationSum: round(precipitation[i], 1),
      windGustMax: round(gusts[i]),
      sunrise: sunrises[i] || null,
      sunset: sunsets[i] || null
    });
  }
  return out;
};

const peakForHazard = (flag, hour) => {
  switch (flag) {
    case 'strongWind':
      return hour.windGust ?? hour.windSpeed;
    case 'heavyRain':
    case 'snowIce':
      return hour.precipitation;
    case 'extremeHeat':
      return hour.feelsLike ?? hour.temperature;
    case 'extremeCold':
    case 'freezing':
      return hour.feelsLike ?? hour.temperature;
    case 'lowVisibility':
      return hour.visibility;
    case 'thunderstorm':
      return hour.weatherCode;
    default:
      return null;
  }
};

const mergePeak = (flag, current, candidate) => {
  if (!Number.isFinite(candidate)) return current;
  if (!Number.isFinite(current)) return candidate;
  return ['extremeCold', 'freezing', 'lowVisibility'].includes(flag)
    ? Math.min(current, candidate)
    : Math.max(current, candidate);
};

/** Consecutive hazardous hours become one actionable interval. */
const buildUpcomingHazards = (hours) => {
  const flags = [...new Set(hours.flatMap((hour) => hour.safetyFlags || []))];
  const hazards = [];

  for (const flag of flags) {
    let active = null;
    for (const hour of hours) {
      if ((hour.safetyFlags || []).includes(flag)) {
        const candidate = peakForHazard(flag, hour);
        if (!active) {
          active = {
            flag,
            startsAt: hour.time,
            endsAt: hour.time,
            peakValue: Number.isFinite(candidate) ? candidate : null
          };
        } else {
          active.endsAt = hour.time;
          active.peakValue = mergePeak(flag, active.peakValue, candidate);
        }
      } else if (active) {
        hazards.push(active);
        active = null;
      }
    }
    if (active) hazards.push(active);
  }

  return hazards
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.flag.localeCompare(b.flag))
    .map(({ peakValue, ...hazard }) =>
      Number.isFinite(peakValue) ? { ...hazard, peakValue } : hazard
    );
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
export const getWeatherSnapshot = async ({
  location,
  language = 'en',
  forecastWindow = parseForecastWindow('')
} = {}) => {
  const lang = String(language).startsWith('it') ? 'it' : 'en';
  if (!location) return null;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasExactPoint = hasUsableCoordinates(location);

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

    // Cache the provider's full reusable horizon. Language and the requested
    // projection are intentionally absent from this key: both are applied to
    // the raw data below on every request.
    const timezone = String(location.timezone || place.timezone || 'auto');
    const cacheKey = [
      Number(place.latitude).toFixed(4),
      Number(place.longitude).toFixed(4),
      timezone
    ].join('|');
    let data = readCache(forecastCache, cacheKey);
    if (!data) {
      data = await fetchForecast({
        latitude: place.latitude,
        longitude: place.longitude,
        timezone
      });

      const fetchedCurrent = data?.current;
      if (!fetchedCurrent || !Number.isFinite(fetchedCurrent.temperature_2m)) {
        console.warn('[weather.service] forecast response carried no current conditions');
        return null;
      }
      writeCache(forecastCache, cacheKey, data, FORECAST_TTL_MS);
    }

    const current = data?.current;
    if (!current || !Number.isFinite(current.temperature_2m)) {
      console.warn('[weather.service] forecast response carried no current conditions');
      return null;
    }

    const code = Number(current.weather_code);
    const { icon, label } = describeCode(code, lang);
    const allHours = buildHourly(data, lang);
    const projection = resolveForecastProjection(
      allHours,
      current.time,
      forecastWindow
    );
    const hourly = projection.hours;
    const upcomingHazards = buildUpcomingHazards(hourly);
    const currentSafetyFlags = buildSafetyFlags({
      code,
      temperature: current.temperature_2m,
      apparent: current.apparent_temperature,
      windGust: current.wind_gusts_10m,
      windSpeed: current.wind_speed_10m,
      precipitation: current.precipitation,
      visibility: current.visibility
    });

    return {
      provider: 'open-meteo',
      place: {
        name: place.name,
        region: place.region,
        country: place.country,
        countryCode: place.countryCode
      },
      observedAt: current.time || new Date().toISOString(),
      timezone: data?.timezone || place.timezone || '',
      // ASCII escape prevents the degree symbol from being double-encoded by
      // deployments that do not preserve source-file encoding.
      units: { temperature: '\u00B0C', wind: 'km/h', precipitation: 'mm' },
      current: {
        temperature: round(current.temperature_2m),
        feelsLike: round(current.apparent_temperature),
        humidity: round(current.relative_humidity_2m),
        precipitation: round(current.precipitation, 1),
        windSpeed: round(current.wind_speed_10m),
        windGust: round(current.wind_gusts_10m),
        visibility: round(current.visibility),
        weatherCode: Number.isFinite(code) ? code : null,
        icon,
        condition: label,
        isDay: current.is_day !== 0
      },
      hourly,
      daily: buildDaily(data, lang),
      // Backward compatible: these remain conditions active now. Future risks
      // have their own timed representation so tomorrow's storm is not labelled
      // as if it were already overhead.
      safetyFlags: currentSafetyFlags,
      forecastSafetyFlags: [...new Set(upcomingHazards.map((hazard) => hazard.flag))],
      upcomingHazards,
      requestedHours: projection.requestedHours,
      availableHours: hourly.length,
      forecastStartsAt: hourly[0]?.time || null,
      forecastEndsAt: hourly.at(-1)?.time || null,
      complete: hourly.length >= projection.requestedHours,
      forecastMode: forecastWindow?.mode || 'rolling'
    };
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

const summarizeHourlyForecast = (hourly) => {
  const byDate = new Map();

  for (const hour of hourly || []) {
    const date = localDate(hour.time);
    if (!date) continue;
    const summary = byDate.get(date) || {
      first: hour.time,
      last: hour.time,
      temperatures: [],
      conditions: [],
      precipitationChance: null,
      windGust: null
    };
    summary.last = hour.time;
    if (Number.isFinite(hour.temperature)) summary.temperatures.push(hour.temperature);
    if (hour.condition && !summary.conditions.includes(hour.condition)) {
      summary.conditions.push(hour.condition);
    }
    if (Number.isFinite(hour.precipitationChance)) {
      summary.precipitationChance = Math.max(
        summary.precipitationChance ?? 0,
        hour.precipitationChance
      );
    }
    if (Number.isFinite(hour.windGust)) {
      summary.windGust = Math.max(summary.windGust ?? 0, hour.windGust);
    }
    byDate.set(date, summary);
  }

  return [...byDate.entries()].map(([date, summary]) => {
    const pieces = [];
    if (summary.temperatures.length) {
      pieces.push(
        `${Math.min(...summary.temperatures)}-${Math.max(...summary.temperatures)}\u00B0C`
      );
    }
    if (summary.conditions.length) {
      pieces.push(summary.conditions.slice(0, 3).join(' / '));
    }
    if (Number.isFinite(summary.precipitationChance)) {
      pieces.push(`precipitation chance up to ${summary.precipitationChance}%`);
    }
    if (Number.isFinite(summary.windGust)) {
      pieces.push(`gusts up to ${summary.windGust} km/h`);
    }
    return `- ${date} ${String(summary.first).slice(11, 16)}-${String(summary.last).slice(11, 16)}: ${pieces.join('; ')}`;
  });
};

/**
 * The model gets one compact line per covered local date, not 168 raw rows.
 * This is enough to answer the requested period and time safety advice without
 * inflating every weather prompt.
 */
export const formatWeatherContext = (snapshot, language = 'en') => {
  if (!snapshot) return '';
  const lang = String(language).startsWith('it') ? 'it' : 'en';
  const { place, current, safetyFlags, hourly, upcomingHazards } = snapshot;

  const where = [place.name, place.region, place.country]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ');

  const lines = [
    `MEASURED WEATHER DATA for ${where} (source: Open-Meteo, observed ${snapshot.observedAt}, timezone ${snapshot.timezone || 'local'}):`,
    `- Condition now: ${current.condition}`,
    `- Temperature now: ${current.temperature}\u00B0C (feels like ${current.feelsLike}\u00B0C)`,
    `- Wind now: ${current.windSpeed} km/h, gusts ${current.windGust} km/h`,
    `- Humidity now: ${current.humidity}%`,
    `- Precipitation now: ${current.precipitation} mm`,
    `- Requested forecast coverage: ${snapshot.availableHours ?? hourly?.length ?? 0}/${snapshot.requestedHours ?? hourly?.length ?? 0} hours, ` +
      `${snapshot.forecastStartsAt || 'unavailable'} through ${snapshot.forecastEndsAt || 'unavailable'} ` +
      `(${snapshot.complete === false ? 'PARTIAL' : 'complete'})`
  ];

  const forecastSummary = summarizeHourlyForecast(hourly);
  if (forecastSummary.length) {
    lines.push('FORECAST SUMMARY BY LOCAL DATE:', ...forecastSummary);
  }

  const notes = FLAG_NOTES[lang] || FLAG_NOTES.en;
  if (safetyFlags?.length) {
    lines.push(
      `- Active safety-relevant conditions: ${safetyFlags
        .map((flag) => notes[flag] || flag)
        .join('; ')}`
    );
  } else {
    lines.push('- Active safety-relevant conditions: none.');
  }

  if (upcomingHazards?.length) {
    lines.push('UPCOMING SAFETY-RELEVANT PERIODS:');
    for (const hazard of upcomingHazards.slice(0, 8)) {
      lines.push(
        `- ${notes[hazard.flag] || hazard.flag}: ${hazard.startsAt} through ${hazard.endsAt}`
      );
    }
    if (upcomingHazards.length > 8) {
      lines.push(`- ${upcomingHazards.length - 8} additional intervals are shown in the card.`);
    }
  } else {
    lines.push('- Upcoming safety-relevant periods: none in the covered forecast.');
  }

  lines.push(
    '',
    'HOW TO USE THIS DATA:',
    '- These figures are verified. State them as fact; never say you cannot access current weather.',
    '- Answer the exact requested forecast period with a concise overview of changes, timing, and safety implications.',
    '- The app already shows the detailed hourly figures in a weather card. Do NOT list them again hour by hour.',
    '- If coverage is PARTIAL, clearly state how many forecast hours were available.',
    '- Never tell the user to go and check a weather site for these conditions - they already have them.',
    '- If an official alert is active for this area, say so briefly; otherwise do not invent one.'
  );

  return lines.join('\n');
};
