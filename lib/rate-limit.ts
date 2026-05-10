/**
 * Simple in-memory rate limiter.
 * Works within a single serverless instance; good enough for abuse prevention
 * in a low-traffic app. For multi-instance production use, replace with Upstash Redis.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetIn: number; // ms until window resets
}

/**
 * @param key        Unique identifier (e.g. `uid:create-checkout`)
 * @param max        Max requests allowed in the window
 * @param windowMs   Window size in milliseconds (default: 60 s)
 */
export function checkRateLimit(
  key: string,
  max = 10,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetIn: windowMs };
  }

  bucket.count += 1;
  const remaining = Math.max(0, max - bucket.count);
  return {
    ok: bucket.count <= max,
    remaining,
    resetIn: bucket.resetAt - now,
  };
}

// Periodic cleanup to avoid unbounded Map growth (runs lazily)
let lastClean = Date.now();
export function maybeCleanBuckets() {
  const now = Date.now();
  if (now - lastClean < 300_000) return; // clean at most every 5 min
  lastClean = now;
  buckets.forEach((b, k) => {
    if (b.resetAt <= now) buckets.delete(k);
  });
}
