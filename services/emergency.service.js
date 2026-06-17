import EmergencyResponse from '../models/emergencyResponse.model.js';
import { getSetting } from './settings.service.js';
import { normalizeLanguageCode } from './language.service.js';

/**
 * Emergency response override engine.
 *
 * When Settings.emergencyOverrideEnabled is true, user chat input is screened
 * against the admin-managed EmergencyResponse documents BEFORE the AI is called.
 * If any active response (for the request language) has a triggerKeyword that
 * appears (case-insensitive, simple substring) in the user's text, that response
 * is returned verbatim and the AI is skipped.
 *
 * The matching strategy is intentionally isolated in matchKeyword() so it can be
 * upgraded later (stemming, fuzzy match, scoring) without touching callers.
 */

const normalizeText = (value) => String(value || '').toLowerCase();

/**
 * Returns true when any of the supplied keywords appears in the (already
 * lowercased) text. Keep this isolated so the matching algorithm can evolve.
 */
const matchKeyword = (lowerText, triggerKeywords = []) => {
  if (!lowerText) return false;

  return triggerKeywords.some((keyword) => {
    const needle = normalizeText(keyword).trim();
    if (!needle) return false;
    return lowerText.includes(needle);
  });
};

/**
 * Finds the highest-priority active EmergencyResponse whose trigger keywords
 * match the given text, scoped to the request language.
 *
 * @param {{ text: string, language?: string }} params
 * @returns {Promise<import('mongoose').Document|null>} the matched doc or null
 */
export const matchEmergencyResponse = async ({ text, language } = {}) => {
  const trimmedText = String(text || '').trim();
  if (!trimmedText) return null;

  const overrideEnabled = await getSetting('emergencyOverrideEnabled');
  if (!overrideEnabled) return null;

  const lang = normalizeLanguageCode(language, 'en');
  const lowerText = normalizeText(trimmedText);

  // Ordered by 'order' so admins control match precedence; first match wins.
  const responses = await EmergencyResponse.find({
    language: lang,
    active: true
  })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  for (const response of responses) {
    if (matchKeyword(lowerText, response.triggerKeywords)) {
      return response;
    }
  }

  return null;
};

/**
 * Lists active emergency responses for the public/user-facing endpoint,
 * optionally filtered by category, scoped to the request language, ordered.
 *
 * @param {{ category?: string, language?: string }} params
 * @returns {Promise<Array>} active emergency responses (lean docs)
 */
export const listActiveEmergencyResponses = async ({
  category,
  language
} = {}) => {
  const filter = { active: true };

  if (language !== undefined && language !== null && language !== '') {
    filter.language = normalizeLanguageCode(language, 'en');
  }

  const trimmedCategory = String(category || '').trim();
  if (trimmedCategory) {
    filter.category = trimmedCategory;
  }

  return EmergencyResponse.find(filter)
    .sort({ order: 1, createdAt: 1 })
    .lean();
};
