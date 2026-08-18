import catchAsync from '../utils/catchAsync.js';
import { fetchAiPrompt } from '../services/ai.service.js';
import { resolveRequestLanguage } from '../services/language.service.js';
import { getSetting } from '../services/settings.service.js';
import { getAllowedDomains } from '../services/webSearch.service.js';
import {
  listActiveLiveInfoSuggestions,
  serializeLiveInfoSuggestion
} from './liveInfoSuggestion.controller.js';
import { sendSuccess } from '../utils/response.js';

export const getChatConfig = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  const [prompt, webSearchEnabled, suggestions, allowedDomains] =
    await Promise.all([
      fetchAiPrompt(language),
      getSetting('webSearchEnabled'),
      listActiveLiveInfoSuggestions(language),
      getAllowedDomains()
    ]);

  // Live Information shortcuts are only useful if a search can actually run:
  // the feature has to be on AND at least one source approved.
  const liveInfoAvailable =
    Boolean(webSearchEnabled) && allowedDomains.length > 0;

  sendSuccess(res, {
    message: 'Chat config fetched successfully',
    data: {
      welcomeMessage: prompt.welcomeMessage || '',
      suggestedQuestions: prompt.suggestedQuestions || [],
      webSearchEnabled: liveInfoAvailable,
      liveInfoSuggestions: liveInfoAvailable
        ? suggestions.map((doc) => {
            const item = serializeLiveInfoSuggestion(doc);
            return {
              id: item.id,
              title: item.title,
              prompt: item.prompt,
              icon: item.icon,
              order: item.order
            };
          })
        : []
    }
  });
});
