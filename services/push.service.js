import DeviceToken from '../models/deviceToken.model.js';

/**
 * Firebase Cloud Messaging (FCM) push delivery.
 *
 * Configuration is lazy and best-effort: the engine must never crash because
 * push is unconfigured. Set:
 *  - FCM_SERVICE_ACCOUNT_JSON : the full service-account JSON as a string
 *    (identical to the JSON file Firebase hands you).
 *
 * When it is not set, every send is a no-op that returns { skipped: true }.
 * sendToUser NEVER throws — it always resolves with a result summary so the
 * dispatch loop can record intent without aborting on a bad token.
 */

let initialized = false;
let messaging = null;

const tryInitFirebaseAdmin = async () => {
  if (initialized) {
    return;
  }
  initialized = true;

  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
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
  Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON);

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
export const sendToUser = async (
  userId,
  { title, body, data = {}, ttlMs } = {}
) => {
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

    // High priority + explicit channel so user-facing notifications are
    // delivered promptly (not batched under Doze) and rendered on the app's
    // reminders channel. TTL is optional and per-call: time-sensitive reminders
    // pass a window (a late reminder is useless), while alerts like a premium
    // upgrade omit it so FCM uses its default (~4 week) retention.
    const response = await messaging.sendEachForMulticast({
      tokens: tokenValues,
      notification: {
        title: String(title || ''),
        body: String(body || '')
      },
      data: stringifyData(data),
      android: {
        priority: 'high',
        notification: { channelId: 'wesafe_reminders' },
        ...(ttlMs ? { ttl: ttlMs } : {})
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          ...(ttlMs
            ? {
                'apns-expiration': String(
                  Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000)
                )
              }
            : {})
        },
        payload: { aps: { sound: 'default' } }
      }
    });

    // Prune tokens the FCM service reports as permanently invalid so the
    // device_tokens collection doesn't accumulate dead entries over time.
    const deadTokens = [];
    response.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-argument'
      ) {
        deadTokens.push(tokenValues[i]);
      }
    });
    if (deadTokens.length > 0) {
      await DeviceToken.deleteMany({ token: { $in: deadTokens } });
    }

    return {
      skipped: false,
      successCount: response.successCount,
      failureCount: response.failureCount,
      pruned: deadTokens.length,
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
