import User from '../models/user.model.js';
import ApprovedDomain, {
  MAX_ALLOWED_DOMAINS
} from '../models/approvedDomain.model.js';
import WebSearchUsage from '../models/webSearchUsage.model.js';
import { getSetting } from './settings.service.js';
import { isPremiumUser } from './premium.service.js';
import { normalizeLanguage } from './aiPrompts.js';

const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

/* ------------------------------------------------------------------ *
 * 1. The cost gate
 * ------------------------------------------------------------------ */

/**
 * Strips accents and punctuation so "Ci sono allerte?" and "ci sono allerte"
 * match the same trigger. Italian triggers are stored unaccented for this reason.
 */
const normalizeForMatch = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // drop the combining marks NFD just split off
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Decides whether the web_search tool should even be OFFERED to the model.
 *
 * This is the client's primary cost control: if nothing matches, the request
 * follows the ordinary chat.completions path and cannot incur a search charge.
 * When it does match, the tool is offered with tool_choice:'auto' - the model
 * still decides, so a false positive here costs nothing by itself.
 *
 * Multi-word triggers match as phrases; single-word triggers match on word
 * boundaries, so "ora" does not fire inside "lavoratore".
 */
export const matchesTriggers = (text, triggers) => {
  const haystack = normalizeForMatch(text);
  if (!haystack) return false;

  const list = Array.isArray(triggers) ? triggers : [];
  const words = new Set(haystack.split(' '));

  return list.some((rawTrigger) => {
    const trigger = normalizeForMatch(rawTrigger);
    if (!trigger) return false;
    return trigger.includes(' ')
      ? haystack.includes(trigger)
      : words.has(trigger);
  });
};

export const shouldConsiderWebSearch = async ({
  text,
  language,
  force = false
}) => {
  // Dedicated Live Information actions have already expressed intent. Return
  // before the trigger settings read so an admin prompt edit cannot break a
  // button by accidentally removing its keyword.
  if (force) return true;

  const lang = normalizeLanguage(language);
  const triggers = await getSetting('webSearchTriggers');
  return matchesTriggers(text, triggers?.[lang]);
};

/* ------------------------------------------------------------------ *
 * 2. Approved domains
 * ------------------------------------------------------------------ */

const DOMAIN_CACHE_TTL_MS = 60_000;
let domainCache = null; // { value, expiresAt }

export const invalidateApprovedDomainCache = () => {
  domainCache = null;
};

/**
 * Active approved domains, ordered, truncated to OpenAI's 20-domain cap.
 * Returns [] when the admin has approved nothing - callers treat that as
 * "do not search", since an unrestricted search is not what was agreed.
 */
export const getAllowedDomains = async () => {
  const now = Date.now();
  if (domainCache && now < domainCache.expiresAt) {
    return domainCache.value;
  }

  const docs = await ApprovedDomain.find({ active: true })
    .sort({ order: 1, createdAt: 1 })
    .select('domain')
    .lean();

  const all = docs.map((doc) => doc.domain).filter(Boolean);

  if (all.length > MAX_ALLOWED_DOMAINS) {
    console.warn(
      `[webSearch.service] ${all.length} active approved domains exceeds the ` +
        `OpenAI cap of ${MAX_ALLOWED_DOMAINS}; using the first ${MAX_ALLOWED_DOMAINS} by order. ` +
        'Deactivate some domains in the dashboard to choose which ones apply.'
    );
  }

  const value = all.slice(0, MAX_ALLOWED_DOMAINS);
  domainCache = { value, expiresAt: now + DOMAIN_CACHE_TTL_MS };
  return value;
};

/* ------------------------------------------------------------------ *
 * 3. Per-user quota
 * ------------------------------------------------------------------ */

/**
 * Reads the caller's remaining live-search allowance. A limit of 0 means
 * unlimited, matching the convention already used by freeDailyMessageLimit.
 *
 * Deliberately NOT route middleware: the quota is only relevant once we know a
 * search is actually warranted, which is decided mid-request.
 */
export const checkWebSearchQuota = async (user) => {
  const premium = isPremiumUser(user);
  const limit = await getSetting(
    premium ? 'webSearchPremiumDailyLimit' : 'webSearchFreeDailyLimit'
  );

  const today = todayStr();
  const stored = user?.dailyUsage;
  const used =
    stored && stored.date === today ? stored.webSearches || 0 : 0;

  return {
    premium,
    limit,
    used,
    unlimited: limit === 0,
    allowed: limit === 0 || used < limit
  };
};

/**
 * Records one actually-performed search against both the per-user daily bucket
 * and the global daily roll-up.
 *
 * Call this ONLY after the model really searched. Charging on intent would
 * inflate the dashboard counters the client intends to budget Phase 2 against.
 */
export const recordWebSearch = async ({ userId, premium = false }) => {
  const today = todayStr();

  try {
    await WebSearchUsage.updateOne(
      { _id: today },
      {
        $inc: {
          count: 1,
          ...(premium ? { premiumCount: 1 } : { freeCount: 1 })
        },
        $setOnInsert: { date: today }
      },
      { upsert: true }
    );
  } catch (error) {
    // Counters are reporting, never a reason to fail a user's answer.
    console.error(
      '[webSearch.service] failed to record global usage:',
      error?.message || error
    );
  }

  if (!userId) return;

  try {
    // Reset the bucket if it is stale, otherwise increment in place. Two
    // statements because $inc and $set on the same path cannot be combined.
    const result = await User.updateOne(
      { _id: userId, 'dailyUsage.date': today },
      { $inc: { 'dailyUsage.webSearches': 1 } }
    );

    if (result.matchedCount === 0) {
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            'dailyUsage.date': today,
            'dailyUsage.webSearches': 1
          },
          $setOnInsert: {}
        }
      );
    }
  } catch (error) {
    console.error(
      '[webSearch.service] failed to record user usage:',
      error?.message || error
    );
  }
};

/**
 * Dashboard counters: searches today / this month / total, plus a short daily
 * series the admin UI can render without a charting library.
 */
export const getWebSearchUsageSummary = async ({ days = 30 } = {}) => {
  const today = todayStr();
  const monthPrefix = today.slice(0, 7); // YYYY-MM

  const [todayDoc, monthAgg, totalAgg, byDay] = await Promise.all([
    WebSearchUsage.findById(today).lean(),
    WebSearchUsage.aggregate([
      { $match: { _id: { $regex: `^${monthPrefix}` } } },
      { $group: { _id: null, count: { $sum: '$count' } } }
    ]),
    WebSearchUsage.aggregate([
      { $group: { _id: null, count: { $sum: '$count' } } }
    ]),
    WebSearchUsage.find().sort({ _id: -1 }).limit(days).lean()
  ]);

  return {
    today: todayDoc?.count || 0,
    todayFree: todayDoc?.freeCount || 0,
    todayPremium: todayDoc?.premiumCount || 0,
    month: monthAgg[0]?.count || 0,
    total: totalAgg[0]?.count || 0,
    byDay: byDay
      .map((doc) => ({
        date: doc.date || doc._id,
        count: doc.count || 0,
        freeCount: doc.freeCount || 0,
        premiumCount: doc.premiumCount || 0
      }))
      .reverse()
  };
};

/* ------------------------------------------------------------------ *
 * 4. Sources
 * ------------------------------------------------------------------ */

const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * How many source chips an answer may show. A single search can consult 20+
 * pages; dumping them all under the bubble buries the answer. The cited ones
 * are what the answer is actually based on, so they win the available slots.
 */
export const MAX_SOURCES_SHOWN = 5;

/** At most this many chips from any one domain, so the list stays varied. */
const MAX_PER_DOMAIN = 2;

/**
 * Builds a readable label from a URL when the tool gave no page title.
 * "…/mappe-rischi/bollettino-di-criticita/" becomes "Bollettino di criticita",
 * which beats five identical chips all reading "protezionecivile.gov.it".
 */
const labelFromUrl = (url) => {
  try {
    const segments = new URL(String(url)).pathname
      .split('/')
      .filter((part) => part && !/^\d+$/.test(part));
    if (segments.length === 0) return '';

    const last = decodeURIComponent(segments[segments.length - 1])
      .replace(/\.(html?|php|aspx?|pdf)$/i, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Hashed filenames and other opaque slugs are worse than nothing.
    if (!last || last.length < 3 || /^[0-9a-f]{16,}$/i.test(last)) return '';

    return last.charAt(0).toUpperCase() + last.slice(1);
  } catch {
    return '';
  }
};

/**
 * Drops tracking params (OpenAI appends `utm_source=openai`) so the same page
 * cited once and consulted once collapses into a single chip instead of two.
 */
const canonicalUrl = (url) => {
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === 'ref' || key === 'source') {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url || '').trim();
  }
};

/**
 * Collects the official sources behind an answer, from both places the
 * Responses API exposes them:
 *  - web_search_call.action.sources : everything the tool consulted
 *  - url_citation annotations       : what the model actually cited
 *
 * Citations are preferred (they are what the answer is based on) and the
 * consulted list fills in behind them. Deduped by URL.
 */
export const extractSources = (response) => {
  const output = Array.isArray(response?.output) ? response.output : [];
  const byUrl = new Map();

  const add = ({ url, title }) => {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return;

    const key = canonicalUrl(cleanUrl);
    if (!key) return;

    const existing = byUrl.get(key);
    const trimmedTitle = String(title || '').trim();

    // A later pass may carry a real page title where the first had none.
    if (existing) {
      if (!existing.hasRealTitle && trimmedTitle) {
        existing.title = trimmedTitle;
        existing.hasRealTitle = true;
      }
      return;
    }

    const domain = hostOf(cleanUrl);
    byUrl.set(key, {
      title: trimmedTitle || labelFromUrl(cleanUrl) || domain || cleanUrl,
      url: cleanUrl,
      domain,
      hasRealTitle: trimmedTitle.length > 0
    });
  };

  // Pass 1: what the model cited.
  for (const item of output) {
    if (item?.type !== 'message') continue;
    for (const contentPart of item.content || []) {
      for (const annotation of contentPart?.annotations || []) {
        if (annotation?.type === 'url_citation') {
          add({ url: annotation.url, title: annotation.title });
        }
      }
    }
  }

  // Pass 2: what the tool consulted. Insertion order keeps citations first, so
  // the truncation below always keeps the sources the answer actually used.
  for (const item of output) {
    if (item?.type !== 'web_search_call') continue;
    for (const source of item?.action?.sources || []) {
      add({ url: source?.url, title: source?.title });
    }
  }

  // Cap per domain before the overall cap: a search that consults twenty pages
  // on one site should not fill every slot with that one site.
  const perDomain = new Map();
  const balanced = [];
  for (const source of byUrl.values()) {
    const used = perDomain.get(source.domain) || 0;
    if (used >= MAX_PER_DOMAIN) continue;
    perDomain.set(source.domain, used + 1);
    balanced.push(source);
    if (balanced.length >= MAX_SOURCES_SHOWN) break;
  }

  return balanced.map(({ title, url, domain }) => ({ title, url, domain }));
};

/** True when the response contains at least one real search call. */
export const responseUsedWebSearch = (response) =>
  (Array.isArray(response?.output) ? response.output : []).some(
    (item) => item?.type === 'web_search_call'
  );

/* ------------------------------------------------------------------ *
 * 5. Location
 * ------------------------------------------------------------------ */

/**
 * Builds the OpenAI `user_location` object. The tool takes coarse free text
 * (city / region / country / timezone), never coordinates - the app is expected
 * to reverse-geocode before sending. Returns null when nothing usable is known,
 * in which case the search simply runs without location bias.
 */
export const buildUserLocation = (location) => {
  if (!location) return null;

  const city = String(location.city || '').trim();
  const region = String(location.region || '').trim();
  const country = String(location.country || '').trim().toUpperCase();
  const timezone = String(location.timezone || '').trim();

  if (!city && !region && !country) return null;

  const payload = { type: 'approximate' };
  if (city) payload.city = city;
  if (region) payload.region = region;
  if (/^[A-Z]{2}$/.test(country)) payload.country = country;
  if (timezone) payload.timezone = timezone;

  return payload;
};
