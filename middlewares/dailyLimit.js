import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import User from '../models/user.model.js';
import { getSetting } from '../services/settings.service.js';
import { isPremiumUser } from '../services/premium.service.js';

const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

/**
 * Per-day usage gate for free users. Premium users skip entirely.
 * `kind` is 'messages' or 'chats'; the matching Settings key supplies the limit.
 * A configured limit of 0 means "unlimited" (use adsEnabled/other gates to block).
 * On exceed: 429 with { code: 'DAILY_LIMIT_REACHED', details: { limit, used } }.
 */
export const enforceDailyLimit = (kind) => async (req, res, next) => {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication required');
    }

    if (isPremiumUser(user)) {
      return next();
    }

    const limitKey = kind === 'chats' ? 'freeDailyChatLimit' : 'freeDailyMessageLimit';
    const limit = await getSetting(limitKey);

    const today = todayStr();
    const current =
      user.dailyUsage && user.dailyUsage.date === today
        ? { date: today, messages: user.dailyUsage.messages || 0, chats: user.dailyUsage.chats || 0 }
        : { date: today, messages: 0, chats: 0 };

    const used = current[kind] || 0;

    if (limit > 0 && used >= limit) {
      const err = new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        'Daily limit reached. Upgrade to premium for unlimited access.'
      );
      err.code = 'DAILY_LIMIT_REACHED';
      err.details = { limit, used, kind };
      throw err;
    }

    current[kind] = used + 1;
    await User.updateOne({ _id: user._id }, { $set: { dailyUsage: current } });
    req.auth.user.dailyUsage = current;

    next();
  } catch (error) {
    next(error);
  }
};
