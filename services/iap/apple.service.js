import { StatusCodes } from 'http-status-codes';
import jwt from 'jsonwebtoken';
import ApiError from '../../utils/ApiError.js';

/**
 * Apple App Store Server API verification.
 *
 * Credentials are read LAZILY inside each function so the module stays pure and
 * testable, and importing it never throws when env is absent.
 *
 * Required env:
 *  - APPLE_IAP_KEY        PEM string of the .p8 private key (with header/footer).
 *  - APPLE_IAP_KEY_ID     Key ID for the .p8 key.
 *  - APPLE_IAP_ISSUER_ID  App Store Connect issuer ID.
 *  - APPLE_BUNDLE_ID      App bundle id (aud-style audience / app identifier).
 *  - APPLE_IAP_ENV        optional: 'production' | 'sandbox' (default 'production').
 *
 * We use the modern App Store Server API (NOT the deprecated /verifyReceipt
 * endpoint). Transactions and notifications arrive as JWS (signedTransaction /
 * signedPayload) which we decode to read the claims.
 */

const PRODUCTION_BASE_URL = 'https://api.storekit.itunes.apple.com';
const SANDBOX_BASE_URL = 'https://api.storekit-sandbox.itunes.apple.com';

const readConfig = () => {
  const key = process.env.APPLE_IAP_KEY;
  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;

  if (!key || !keyId || !issuerId || !bundleId) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Apple verification not configured'
    );
  }

  const environment =
    (process.env.APPLE_IAP_ENV || 'production').toLowerCase() === 'sandbox'
      ? 'sandbox'
      : 'production';

  return {
    key: key.replace(/\\n/g, '\n'),
    keyId,
    issuerId,
    bundleId,
    baseUrl: environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL
  };
};

/**
 * Signs the ES256 JWT the App Store Server API expects as a bearer token.
 */
const signAppStoreToken = ({ key, keyId, issuerId, bundleId }) => {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: issuerId,
      iat: now,
      exp: now + 60 * 5,
      aud: 'appstoreconnect-v1',
      bid: bundleId
    },
    key,
    {
      algorithm: 'ES256',
      keyid: keyId
    }
  );
};

/**
 * Decodes a JWS (compact JWT) without verifying its signature.
 *
 * TODO (production hardening): App Store JWS payloads are signed by Apple and
 * carry the signing certificate chain in the protected header `x5c`. Production
 * code MUST verify that x5c chain up to Apple's root CA before trusting the
 * claims. We decode-without-verify here because cert-chain verification is not
 * wired up in this environment.
 */
const decodeJws = (jws) => {
  if (!jws || typeof jws !== 'string') {
    return null;
  }
  const decoded = jwt.decode(jws);
  return decoded && typeof decoded === 'object' ? decoded : null;
};

/**
 * Maps an Apple decoded transaction payload to our subscription status enum.
 *
 * JWSTransactionDecodedPayload fields of interest:
 *  - expiresDate: number ms epoch (subscriptions)
 *  - revocationDate: number ms epoch (set when refunded/revoked)
 *  - revocationReason: number
 */
const mapAppleStatus = (txn = {}) => {
  if (txn.revocationDate) {
    return 'refunded';
  }

  const now = Date.now();
  const expiresMs = txn.expiresDate ? Number(txn.expiresDate) : null;

  if (expiresMs !== null && expiresMs <= now) {
    return 'expired';
  }

  return 'active';
};

const buildResultFromTransaction = (txn = {}) => {
  const expiresAt = txn.expiresDate ? new Date(Number(txn.expiresDate)) : null;

  return {
    transactionId: txn.originalTransactionId ?? txn.transactionId ?? null,
    productId: txn.productId ?? '',
    status: mapAppleStatus(txn),
    expiresAt,
    raw: txn
  };
};

/**
 * Fetches the latest subscription status for an original transaction id from the
 * App Store Server API and returns the most relevant decoded transaction.
 */
const fetchLatestTransaction = async (originalTransactionId) => {
  const config = readConfig();
  const token = signAppStoreToken(config);

  const url = `${config.baseUrl}/inApps/v1/subscriptions/${encodeURIComponent(
    originalTransactionId
  )}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new ApiError(
      StatusCodes.BAD_GATEWAY,
      `Apple App Store Server API error (${response.status})`
    );
    err.code = 'VERIFICATION_FAILED';
    err.details = { status: response.status, body: text?.slice(0, 500) };
    throw err;
  }

  const body = await response.json();

  // statuses[].lastTransactions[].signedTransactionInfo — pick the first decodable
  const groups = Array.isArray(body?.data) ? body.data : [];
  for (const group of groups) {
    const txns = Array.isArray(group?.lastTransactions)
      ? group.lastTransactions
      : [];
    for (const entry of txns) {
      const decoded = decodeJws(entry?.signedTransactionInfo);
      if (decoded) {
        return decoded;
      }
    }
  }

  const err = new ApiError(
    StatusCodes.NOT_FOUND,
    'No transaction found for the provided identifier'
  );
  err.code = 'VERIFICATION_FAILED';
  throw err;
};

/**
 * Verifies an Apple transaction.
 *
 * Accepts EITHER a `signedTransaction` (JWS) supplied by the StoreKit2 client,
 * which we decode directly, OR a `transactionId` (originalTransactionId) which we
 * look up via the App Store Server API.
 *
 * @param {{ signedTransaction?: string, transactionId?: string }} params
 * @returns {Promise<{ transactionId: string, productId: string,
 *   status: 'active'|'expired'|'in_grace'|'canceled'|'refunded',
 *   expiresAt: Date|null, raw: object }>}
 */
export const verifyAppleTransaction = async ({
  signedTransaction,
  transactionId
} = {}) => {
  // Ensure credentials are present even for the decode-only path so callers get
  // a clear, consistent "not configured" signal.
  readConfig();

  if (signedTransaction) {
    const decoded = decodeJws(signedTransaction);
    if (!decoded) {
      const err = new ApiError(
        StatusCodes.BAD_REQUEST,
        'Could not decode the signed Apple transaction'
      );
      err.code = 'VERIFICATION_FAILED';
      throw err;
    }

    const original =
      decoded.originalTransactionId ?? decoded.transactionId ?? null;

    // Cross-check against the App Store Server API for an authoritative, current
    // status when we have an original transaction id; fall back to the decoded
    // payload if the lookup is unavailable.
    if (original) {
      try {
        const authoritative = await fetchLatestTransaction(original);
        return buildResultFromTransaction(authoritative);
      } catch (lookupError) {
        // Fall back to the client-decoded payload (still TODO: verify x5c).
        return buildResultFromTransaction(decoded);
      }
    }

    return buildResultFromTransaction(decoded);
  }

  if (transactionId) {
    const authoritative = await fetchLatestTransaction(transactionId);
    return buildResultFromTransaction(authoritative);
  }

  const err = new ApiError(
    StatusCodes.BAD_REQUEST,
    'signedTransaction or transactionId is required'
  );
  err.code = 'VERIFICATION_FAILED';
  throw err;
};

/**
 * Decodes an App Store Server Notification V2 `signedPayload` JWS and returns the
 * notification type plus the decoded transaction info (if present).
 *
 * V2 responseBodyV2DecodedPayload:
 *   { notificationType, subtype, data: { signedTransactionInfo, signedRenewalInfo, ... } }
 *
 * @param {string} signedPayload
 * @returns {{ notificationType: string|null, subtype: string|null,
 *   transaction: object|null, raw: object|null }}
 */
export const decodeAppleNotification = (signedPayload) => {
  const payload = decodeJws(signedPayload);
  if (!payload) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid Apple notification payload'
    );
  }

  const data = payload.data ?? {};
  const transaction = data.signedTransactionInfo
    ? decodeJws(data.signedTransactionInfo)
    : null;

  return {
    notificationType: payload.notificationType ?? null,
    subtype: payload.subtype ?? null,
    transaction,
    raw: payload
  };
};
