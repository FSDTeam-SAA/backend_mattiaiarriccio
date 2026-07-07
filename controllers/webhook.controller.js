import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import Subscription from '../models/subscription.model.js';
import { applySubscription } from '../services/premium.service.js';
import {
  notifyPremiumRenewed,
  notifyPremiumExpired,
  notifyPremiumCanceled,
  notifyPremiumPaymentFailed
} from '../services/subscriptionNotifications.service.js';
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
    // Best-effort user notification on the lifecycle transition. Never let a
    // notification failure turn a benign webhook into a provider retry storm.
    try {
      await notifyOnSubscriptionTransition({ ownerId, existing, verified });
    } catch (error) {
      console.error(
        '[webhook] premium notification failed:',
        error?.message || error
      );
    }
    return true;
  }

  return false;
};

/**
 * Maps a subscription status/expiry transition to a user notification.
 *  - active with a later expiry than before  -> renewed
 *  - expired / refunded                       -> expired
 *  - canceled (auto-renew off)                -> canceled (access until expiresAt)
 *  - in_grace (billing retry)                 -> payment failed
 */
const notifyOnSubscriptionTransition = async ({ ownerId, existing, verified }) => {
  const prevStatus = existing?.status || null;
  const newStatus = verified?.status || null;
  const prevExpiry = existing?.expiresAt ? new Date(existing.expiresAt).getTime() : 0;
  const newExpiry = verified?.expiresAt ? new Date(verified.expiresAt).getTime() : 0;

  const nextExpiry = verified?.expiresAt ?? null;

  if (newStatus === 'active') {
    // A real renewal only: the expiry advanced past what we had on record. The
    // notification is deduped by (user, event, new-expiry) so a replayed webhook
    // for the same renewal never notifies twice.
    if (existing && newExpiry > prevExpiry) {
      await notifyPremiumRenewed(ownerId, nextExpiry);
    }
    return;
  }
  if ((newStatus === 'expired' || newStatus === 'refunded') && prevStatus !== newStatus) {
    await notifyPremiumExpired(ownerId, nextExpiry);
    return;
  }
  if (newStatus === 'canceled' && prevStatus !== 'canceled') {
    await notifyPremiumCanceled(ownerId, nextExpiry);
    return;
  }
  if (newStatus === 'in_grace' && prevStatus !== 'in_grace') {
    await notifyPremiumPaymentFailed(ownerId, nextExpiry);
  }
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
