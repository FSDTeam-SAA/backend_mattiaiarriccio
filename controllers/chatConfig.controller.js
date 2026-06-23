import catchAsync from '../utils/catchAsync.js';
import { getSetting } from '../services/settings.service.js';
import { resolveRequestLanguage } from '../services/language.service.js';
import { sendSuccess } from '../utils/response.js';

export const getChatConfig = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const chatWelcomeMessage = await getSetting('chatWelcomeMessage');

  const welcomeMessage =
    (chatWelcomeMessage && chatWelcomeMessage[language]) ||
    (chatWelcomeMessage && chatWelcomeMessage.en) ||
    '';

  sendSuccess(res, {
    message: 'Chat config fetched successfully',
    data: { welcomeMessage }
  });
});
