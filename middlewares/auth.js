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

export const requireAuth = (...allowedRoles) => async (req, res, next) => {
  try {
    const token = getBearerToken(req.headers.authorization);

    if (!token) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication token is required');
    }

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
