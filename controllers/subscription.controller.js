import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import Subscription from '../models/subscription.model.js';
import { applySubscription } from '../services/premium.service.js';
import { verifyGooglePurchase } from '../services/iap/google.service.js';
import { verifyAppleTransaction } from '../services/iap/apple.service.js';

const STORE_MAP = {
  google: 'google_play',
  google_play: 'google_play',
  play: 'google_play',
  apple: 'app_store',
  app_store: 'app_store',
  appstore: 'app_store',
  ios: 'app_store'
};

const normalizeStore = (store) => STORE_MAP[String(store || '').toLowerCase()];

/**
 * Wraps a provider verification call so an expected verification failure surfaces
 * as a clean ApiError (with code) rather than a leaked 500.
 */
const runVerification = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    // Configuration / provider-availability errors keep their own status & message.
    if (error instanceof ApiError) {
      throw error;
    }
    const err = new ApiError(
      StatusCodes.BAD_REQUEST,
      'Subscription verification failed'
    );
    err.code = 'VERIFICATION_FAILED';
    err.details = { reason: error?.message };
    throw err;
  }
};

/**
 * POST /api/v1/subscriptions/verify
 * Body: { store: 'google'|'apple', productId, token }
 *   token = purchaseToken (google) | signedTransaction or transactionId (apple)
 */
export const verifySubscription = catchAsync(async (req, res) => {
  const user = req.auth.user;
  const { store, productId, token } = req.body || {};

  const normalizedStore = normalizeStore(store);
  if (!normalizedStore) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "store must be one of 'google' or 'apple'"
    );
  }

  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'token is required');
  }

  let verified;
  if (normalizedStore === 'google_play') {
    if (!productId) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'productId is required for Google Play verification'
      );
    }
    verified = await runVerification(() =>
      verifyGooglePurchase({ productId, purchaseToken: token })
    );
  } else {
    // Apple: token can be a signedTransaction JWS or an originalTransactionId.
    const looksLikeJws = typeof token === 'string' && token.split('.').length === 3;
    verified = await runVerification(() =>
      verifyAppleTransaction(
        looksLikeJws
          ? { signedTransaction: token }
          : { transactionId: token }
      )
    );
  }

  if (!verified?.transactionId) {
    const err = new ApiError(
      StatusCodes.BAD_REQUEST,
      'Verification did not return a transaction identifier'
    );
    err.code = 'VERIFICATION_FAILED';
    throw err;
  }

  // Upsert by transactionId (unique). Bind ownership to the calling user.
  await Subscription.findOneAndUpdate(
    { transactionId: verified.transactionId },
    {
      $set: {
        userId: user._id,
        store: normalizedStore,
        productId: verified.productId || productId || '',
        status: verified.status,
        expiresAt: verified.expiresAt ?? null,
        latestRaw: verified.raw ?? null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const updatedUser = await applySubscription(user._id);

  sendSuccess(res, {
    message: 'Subscription verified successfully',
    data: {
      status: verified.status,
      expiresAt: verified.expiresAt ?? null,
      tier: updatedUser?.tier ?? user.tier ?? 'free'
    }
  });
});

/**
 * GET /api/v1/subscriptions
 * Lists the calling user's subscriptions (newest first).
 */
export const listMySubscriptions = catchAsync(async (req, res) => {
  const user = req.auth.user;

  const subscriptions = await Subscription.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, {
    message: 'Subscriptions fetched successfully',
    data: subscriptions.map((sub) => ({
      id: sub._id,
      store: sub.store,
      productId: sub.productId,
      status: sub.status,
      expiresAt: sub.expiresAt ?? null,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt
    }))
  });
});
