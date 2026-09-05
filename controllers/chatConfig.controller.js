import catchAsync from '../utils/catchAsync.js';
import { fetchAiPrompt } from '../services/ai.service.js';
import { resolveRequestLanguage } from '../services/language.service.js';
import { getSetting } from '../services/settings.service.js';
import { getAllowedDomains } from '../services/webSearch.service.js';
import {
  listActiveLiveInfoSuggestions,
  serializeLiveInfoSuggestion
} from './liveInfoSuggestion.controller.js';
import { DEFAULT_LIVE_INFO_BUTTONS } from '../services/webSearchSeed.service.js';
import { sendSuccess } from '../utils/response.js';

/**
 * The subset of a suggestion the app needs. The admin-only bookkeeping
 * (createdBy, timestamps, the active flag that already filtered it in) stays on
 * the dashboard side.
 */
const toClientSuggestion = (doc) => {
  const item = serializeLiveInfoSuggestion(doc);
  return {
    id: item.id,
    title: item.title,
    prompt: item.prompt,
    icon: item.icon,
    order: item.order,
    requiresLocation: item.requiresLocation
  };
};

/**
 * Keep the four product-level Live Information actions available when an
 * existing database has no active rows for one language. Configured dashboard
 * rows remain authoritative whenever any exist; the master Web Search/source
 * gates are applied by the caller before this fallback is used.
 */
export const resolveLiveInfoSuggestions = (language, docs = []) => {
  const configured = Array.isArray(docs)
    ? docs.map(toClientSuggestion)
    : [];
  if (configured.length > 0) return configured;

  return DEFAULT_LIVE_INFO_BUTTONS.filter(
    (item) => item.language === language
  ).map((item) => ({
    id: `default-live-${language}-${item.order}`,
    title: item.title,
    prompt: item.prompt,
    icon: item.icon || '',
    order: item.order,
    requiresLocation: item.requiresLocation === true
  }));
};

export const getChatConfig = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  const [
    prompt,
    webSearchEnabled,
    liveInfoDocs,
    questionDocs,
    exampleDocs,
    sectionContent,
    allowedDomains
  ] = await Promise.all([
    fetchAiPrompt(language),
    getSetting('webSearchEnabled'),
    listActiveLiveInfoSuggestions(language, 'live_info'),
    listActiveLiveInfoSuggestions(language, 'suggested_question'),
    listActiveLiveInfoSuggestions(language, 'web_search_example'),
    getSetting('webSearchSectionContent'),
    getAllowedDomains()
  ]);

  // Live Information shortcuts are only useful if a search can actually run:
  // the feature has to be on AND at least one source approved.
  const liveInfoAvailable =
    Boolean(webSearchEnabled) && allowedDomains.length > 0;

  const liveInfoSuggestions = liveInfoAvailable
    ? resolveLiveInfoSuggestions(language, liveInfoDocs)
    : [];

  // Quick Questions have one canonical source: the dashboard-managed rows.
  // Falling back to PromptConfig here would make deleting/disabling the last row
  // resurrect an older list and was also the path that exposed object internals
  // as text in earlier clients.
  const suggestedQuestions = questionDocs.map(toClientSuggestion);

  sendSuccess(res, {
    message: 'Chat config fetched successfully',
    data: {
      welcomeMessage: prompt.welcomeMessage || '',
      suggestedQuestions,
      webSearchEnabled: liveInfoAvailable,
      webSearchSection: sectionContent?.[language] || sectionContent?.en || {},
      liveInfoSuggestions,
      webSearchExamples: liveInfoAvailable
        ? exampleDocs.map(toClientSuggestion)
        : []
    }
  });
});
