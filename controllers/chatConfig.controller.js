import catchAsync from '../utils/catchAsync.js';
import { fetchAiPrompt } from '../services/ai.service.js';
import { resolveRequestLanguage } from '../services/language.service.js';
import { sendSuccess } from '../utils/response.js';

export const getChatConfig = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const prompt = await fetchAiPrompt(language);

  sendSuccess(res, {
    message: 'Chat config fetched successfully',
    data: { welcomeMessage: prompt.welcomeMessage || '' }
  });
});
