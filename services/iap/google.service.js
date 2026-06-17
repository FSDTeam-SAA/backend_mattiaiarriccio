import { StatusCodes } from 'http-status-codes';
import { google } from 'googleapis';
import ApiError from '../../utils/ApiError.js';

/**
 * Google Play Developer API (androidpublisher) subscription verification.
 *
 * Credentials are read LAZILY inside each function so the module stays pure and
 * testable, and so importing it never throws when env is absent.
 *
 * Required env:
 *  - GOOGLE_PLAY_SA_JSON      JSON string of a service-account key with
 *                             androidpublisher scope access to the app.
 *  - GOOGLE_PLAY_PACKAGE_NAME e.g. com.wesafe.app
 */

const ANDROIDPUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const readConfig = () => {
  const saJson = process.env.GOOGLE_PLAY_SA_JSON;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;

  if (!saJson || !packageName) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Google Play verification not configured'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(saJson);
  } catch (parseError) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Google Play verification not configured'
    );
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Google Play verification not configured'
    );
  }

  return { credentials, packageName };
};

const buildPublisherClient = (credentials) => {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [ANDROIDPUBLISHER_SCOPE]
  });

  return google.androidpublisher({ version: 'v3', auth });
};

/**
 * Maps a Google subscription purchase resource to our subscription status enum.
 *
 * Reference fields (subscriptions resource v3):
 *  - expiryTimeMillis: string (ms epoch)
 *  - paymentState: 0 pending, 1 received, 2 free trial, 3 deferred
 *  - cancelReason: 0 user, 1 system, 2 replaced, 3 developer
 *  - autoRenewing: boolean
 */
const mapGoogleStatus = (purchase = {}) => {
  const now = Date.now();
  const expiryMs = purchase.expiryTimeMillis
    ? Number(purchase.expiryTimeMillis)
    : null;
  const expired = expiryMs !== null && expiryMs <= now;

  // A refund is signalled via cancelReason 1 (system, often a refund) combined
  // with an explicit refund acknowledgement. Google does not expose a single
  // "refunded" flag on this resource, so treat cancelReason 1 as refunded.
  if (purchase.cancelReason === 1) {
    return 'refunded';
  }

  if (expired) {
    return 'expired';
  }

  // paymentState 0 = payment pending. While in the grace period the sub is still
  // technically active but payment has not cleared.
  if (purchase.paymentState === 0) {
    return 'in_grace';
  }

  // cancelReason present (0 user / 2 replaced / 3 developer) but not yet expired:
  // access continues until expiry, so report canceled (auto-renew off).
  if (
    purchase.cancelReason !== undefined &&
    purchase.cancelReason !== null
  ) {
    return 'canceled';
  }

  if (purchase.autoRenewing === false) {
    return 'canceled';
  }

  return 'active';
};

/**
 * Verifies a Google Play subscription purchase against the Play Developer API.
 *
 * @param {{ productId: string, purchaseToken: string }} params
 * @returns {Promise<{ transactionId: string, productId: string,
 *   status: 'active'|'expired'|'in_grace'|'canceled'|'refunded',
 *   expiresAt: Date|null, raw: object }>}
 */
export const verifyGooglePurchase = async ({ productId, purchaseToken } = {}) => {
  if (!productId || !purchaseToken) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'productId and purchaseToken are required'
    );
  }

  const { credentials, packageName } = readConfig();
  const publisher = buildPublisherClient(credentials);

  const response = await publisher.purchases.subscriptions.get({
    packageName,
    subscriptionId: productId,
    token: purchaseToken
  });

  const purchase = response?.data ?? {};
  const status = mapGoogleStatus(purchase);
  const expiresAt = purchase.expiryTimeMillis
    ? new Date(Number(purchase.expiryTimeMillis))
    : null;

  return {
    transactionId: purchaseToken,
    productId,
    status,
    expiresAt,
    raw: purchase
  };
};

/**
 * Decodes a Google Real-time Developer Notifications (RTDN) Pub/Sub push
 * message envelope and returns the SubscriptionNotification payload.
 *
 * Pub/Sub push body shape:
 *   { message: { data: <base64 JSON>, messageId, ... }, subscription }
 * The decoded data is a DeveloperNotification:
 *   { version, packageName, eventTimeMillis,
 *     subscriptionNotification: { version, notificationType, purchaseToken, subscriptionId } }
 *
 * @param {object} body raw push request body
 * @returns {{ purchaseToken: string|null, productId: string|null,
 *   notificationType: number|null, packageName: string|null, raw: object }}
 */
export const decodeRtdnMessage = (body = {}) => {
  const data = body?.message?.data;
  if (!data) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid RTDN message envelope');
  }

  let developerNotification;
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf8');
    developerNotification = JSON.parse(decoded);
  } catch (decodeError) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid RTDN message payload');
  }

  const sub = developerNotification?.subscriptionNotification ?? {};

  return {
    purchaseToken: sub.purchaseToken ?? null,
    productId: sub.subscriptionId ?? null,
    notificationType: sub.notificationType ?? null,
    packageName: developerNotification?.packageName ?? null,
    raw: developerNotification
  };
};
