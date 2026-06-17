import DeviceToken from '../models/deviceToken.model.js';

/**
 * Firebase Cloud Messaging (FCM) push delivery.
 *
 * Configuration is lazy and best-effort: the engine must never crash because
 * push is unconfigured. Provide ONE of:
 *  - FCM_SERVICE_ACCOUNT_JSON : the full service-account JSON as a string
 *    (recommended; identical to the JSON file Firebase hands you).
 *  - FCM_SERVER_KEY           : a legacy server key (HTTP v0 / legacy API).
 *
 * When neither is set, every send is a no-op that returns { skipped: true }.
 * sendToUser NEVER throws — it always resolves with a result summary so the
 * dispatch loop can record intent without aborting on a bad token.
 */

let initialized = false;
let messaging = null;
let legacyServerKey = null;

const tryInitFirebaseAdmin = async () => {
  if (initialized) {
    return;
  }
  initialized = true;

  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  legacyServerKey = process.env.FCM_SERVER_KEY || null;

  if (!serviceAccountJson && !legacyServerKey) {
    return;
  }

  if (!serviceAccountJson) {
    // Only the legacy server key is available; nothing to init for firebase-admin.
    return;
  }

  try {
    const adminModule = await import('firebase-admin');
    const admin = adminModule.default || adminModule;

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (parseError) {
      console.error(
        '[push.service] FCM_SERVICE_ACCOUNT_JSON is not valid JSON:',
        parseError?.message || parseError
      );
      return;
    }

    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });

    messaging = app.messaging();
  } catch (error) {
    console.error(
      '[push.service] Failed to initialize firebase-admin:',
      error?.message || error
    );
    messaging = null;
  }
};

export const isPushConfigured = () =>
  Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FCM_SERVER_KEY);

const stringifyData = (data = {}) => {
  // FCM data payload values must be strings.
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    out[key] = value === null || value === undefined ? '' : String(value);
  }
  return out;
};

/**
 * Send a notification to every registered device of a user.
 * Returns a plain summary object; never throws.
 */
export const sendToUser = async (userId, { title, body, data = {} } = {}) => {
  try {
    if (!isPushConfigured()) {
      console.warn(
        `[push.service] FCM not configured; skipping push to user ${userId}`
      );
      return { skipped: true, reason: 'not_configured' };
    }

    const tokens = await DeviceToken.find({ userId }).select('token').lean();
    const tokenValues = tokens.map((doc) => doc.token).filter(Boolean);

    if (tokenValues.length === 0) {
      return { skipped: true, reason: 'no_tokens' };
    }

    await tryInitFirebaseAdmin();

    if (!messaging) {
      console.warn(
        `[push.service] firebase-admin messaging unavailable; skipping push to user ${userId}`
      );
      return { skipped: true, reason: 'messaging_unavailable' };
    }

    const response = await messaging.sendEachForMulticast({
      tokens: tokenValues,
      notification: {
        title: String(title || ''),
        body: String(body || '')
      },
      data: stringifyData(data)
    });

    return {
      skipped: false,
      successCount: response.successCount,
      failureCount: response.failureCount,
      total: tokenValues.length
    };
  } catch (error) {
    console.error(
      `[push.service] sendToUser failed for user ${userId}:`,
      error?.message || error
    );
    return { skipped: true, reason: 'error', error: error?.message || String(error) };
  }
};
