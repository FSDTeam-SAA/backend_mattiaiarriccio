import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import {
  applyUsageSnapshotToAuthUser,
  consumeUserUsage,
  createUsageLimitError
} from '../services/usageLimit.service.js';

/**
 * Backwards-compatible name for the chat quota middleware. It now consumes the
 * current UTC daily AND weekly buckets and applies tier-specific limits. The
 * legacy `chats` counter remains a Free daily new-conversation anti-abuse cap;
 * `messages` is the actual chatbot request allowance for both tiers.
 */
export const enforceDailyLimit = (kind) => async (req, res, next) => {
  try {
    const user = req.auth?.user;
    if (!user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication required');
    }

    const quota = await consumeUserUsage({ user, kind });
    applyUsageSnapshotToAuthUser(req.auth.user, quota);

    if (!quota.allowed) {
      throw createUsageLimitError(quota);
    }

    req.usageQuota = {
      ...(req.usageQuota || {}),
      [kind]: quota
    };

    next();
  } catch (error) {
    next(error);
  }
};
