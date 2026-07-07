/**
 * Minimal in-memory fixed-window rate limiter — no external dependency, so it
 * can never break the app's import graph. Suitable for a single-instance
 * deployment; swap the store for Redis if you scale horizontally.
 *
 * Usage:
 *   app.use('/webhooks', rateLimit({ windowMs: 60_000, max: 100 }), router);
 *   router.post('/send', rateLimit({ max: 10, keyGenerator: byAdmin }), handler);
 */

const buckets = new Map();

export const rateLimit = ({
  windowMs = 60_000,
  max = 60,
  keyGenerator,
  message = 'Too many requests, please try again later'
} = {}) => {
  const makeKey =
    keyGenerator || ((req) => req.ip || req.socket?.remoteAddress || 'global');

  return (req, res, next) => {
    const now = Date.now();
    const key = makeKey(req);

    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message });
    }

    return next();
  };
};

// Periodically drop expired buckets so the map cannot grow unbounded. unref()
// keeps this timer from holding the process open.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(key);
  }
}, 5 * 60_000);
cleanup.unref?.();
