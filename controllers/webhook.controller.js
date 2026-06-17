import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import Subscription from '../models/subscription.model.js';
import { applySubscription } from '../services/premium.service.js';
import {
  decodeRtdnMessage,
  verifyGooglePurchase
} from '../services/iap/google.service.js';
import {
  decodeAppleNotification,
  verifyAppleTransaction
} from '../services/iap/apple.service.js';

/**
 * Persists a freshly verified subscription state and recomputes the owning user's
 * tier. Ownership is resolved from an existing Subscription row for the same
 * transactionId, because store webhooks carry no user identity.
 *
 * @returns {Promise<boolean>} true if a known subscription was updated
 */
const applyVerifiedState = async ({ transactionId, store, verified }) => {
  if (!transactionId) {
    return false;
  }

  const existing = await Subscription.findOne({ transactionId }).lean();

  // Build the update. If we never saw this transaction (no owning user), we
  // cannot attribute it to a user, so we only record it when we know the owner.
  const update = {
    store,
    productId: verified.productId || existing?.productId || '',
    status: verified.status,
    expiresAt: verified.expiresAt ?? null,
    latestRaw: verified.raw ?? null
  };

  if (existing?.userId) {
    update.userId = existing.userId;
  }

  if (!existing) {
    // Unknown transaction with no owner; nothing to attribute. Skip silently so
    // the provider gets a fast 200 instead of a retry storm.
    if (!update.userId) {
      return false;
    }
  }

  await Subscription.findOneAndUpdate(
    { transactionId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const ownerId = update.userId || existing?.userId;
  if (ownerId) {
    await applySubscription(ownerId);
    return true;
  }

  return false;
};

/**
 * POST /webhooks/google/rtdn  (PUBLIC)
 * Google Real-time Developer Notifications (Pub/Sub push). Always returns 200
 * quickly so Pub/Sub does not retry-storm; benign errors are logged + 200.
 */
export const googleRtdn = catchAsync(async (req, res) => {
  try {
    const { purchaseToken, productId } = decodeRtdnMessage(req.body);

    if (purchaseToken && productId) {
      const verified = await verifyGooglePurchase({
        productId,
        purchaseToken
      });

      await applyVerifiedState({
        transactionId: verified.transactionId, // === purchaseToken
        store: 'google_play',
        verified
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[webhook:google/rtdn] handled error:', error?.message);
  }

  sendSuccess(res, { message: 'Notification received', data: { received: true } });
});

/**
 * POST /webhooks/apple/notifications  (PUBLIC)
 * App Store Server Notifications V2 (signedPayload). Always returns 200 quickly;
 * benign errors are logged + 200.
 */
export const appleNotifications = catchAsync(async (req, res) => {
  try {
    const signedPayload = req.body?.signedPayload;

    if (signedPayload) {
      const { transaction } = decodeAppleNotification(signedPayload);
      const originalTransactionId =
        transaction?.originalTransactionId ?? transaction?.transactionId ?? null;

      if (originalTransactionId) {
        const verified = await verifyAppleTransaction({
          transactionId: originalTransactionId
        });

        await applyVerifiedState({
          transactionId: verified.transactionId, // === originalTransactionId
          store: 'app_store',
          verified
        });
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[webhook:apple/notifications] handled error:', error?.message);
  }

  sendSuccess(res, { message: 'Notification received', data: { received: true } });
});
