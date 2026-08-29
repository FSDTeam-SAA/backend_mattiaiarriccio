import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import Session from '../models/session.model.js';
import User from '../models/user.model.js';
import { isExpired } from '../services/security.service.js';

const getBearerToken = (authorizationHeader = '') => {
  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
};

/**
 * Resolves a bearer token to its session + user, pruning the session when it is
 * expired or orphaned. Throws an ApiError for every failure mode so callers can
 * either surface it (requireAuth) or swallow it (optionalAuth).
 */
const resolveSession = async (token) => {
  const session = await Session.findOne({ token }).lean();

  if (!session) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired session token');
  }

  if (isExpired(session.expiresAt)) {
    await Session.deleteOne({ _id: session._id });
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Session expired. Please log in again');
  }

  const user = await User.findById(session.userId).lean();

  if (!user) {
    await Session.deleteOne({ _id: session._id });
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Session user no longer exists');
  }

  return { session, user };
};

export const requireAuth = (...allowedRoles) => async (req, res, next) => {
  try {
    const token = getBearerToken(req.headers.authorization);

    if (!token) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication token is required');
    }

    const { session, user } = await resolveSession(token);

    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'You do not have access to this resource');
    }

    req.auth = {
      session,
      user
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Populates `req.auth` when the caller sent a valid session token, but never
 * rejects the request. For endpoints that must answer both signed-in and
 * anonymous callers (ad config), so a missing, stale, or not-yet-issued token
 * degrades to the anonymous response instead of a 401 the client can only
 * interpret as "something went wrong".
 */
export const optionalAuth = () => async (req, res, next) => {
  const token = getBearerToken(req.headers.authorization);

  if (!token) {
    return next();
  }

  try {
    req.auth = await resolveSession(token);
  } catch (error) {
    // Unresolvable token — continue anonymously rather than failing the request.
  }

  next();
};
