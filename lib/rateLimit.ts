/**
 * Distributed rate limiter — primary implementation uses Upstash Redis
 * (sliding window, correct under concurrent serverless invocations).
 *
 * Automatic fallback: if Redis env vars are not configured (dev / CI),
 * falls back to the Firestore-backed limiter so the app keeps working.
 *
 * All AI routes and critical write endpoints import from this file.
 *
 * SETUP:
 *   npm install @upstash/redis @upstash/ratelimit
 *   Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to .env.local
 */

import { isRedisConfigured } from './redis';

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  limit:      number;
  retryAfter: number; // seconds; 0 if request is allowed
  reset:      number; // epoch ms when current window resets
}

/* ── Redis implementation (primary) ───────────────────────────────────── */

// Cache Ratelimit instances so we don't re-create them per invocation
const redisLimiters = new Map<string, import('@upstash/ratelimit').Ratelimit>();

async function checkWithRedis(
  key:         string,
  maxRequests: number,
  windowMs:    number,
): Promise<RateLimitResult> {
  const { Ratelimit } = await import('@upstash/ratelimit');
  const { getRedis }  = await import('./redis');

  const cacheKey = `${maxRequests}:${windowMs}`;
  if (!redisLimiters.has(cacheKey)) {
    redisLimiters.set(cacheKey, new Ratelimit({
      redis:     getRedis(),
      limiter:   Ratelimit.slidingWindow(maxRequests, `${windowMs} ms`),
      analytics: false,
      prefix:    'fincaos_rl',
    }));
  }

  const result = await redisLimiters.get(cacheKey)!.limit(key);

  return {
    allowed:    result.success,
    remaining:  result.remaining,
    limit:      result.limit,
    retryAfter: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)),
    reset:      result.reset,
  };
}

/* ── Firestore fallback (dev / unconfigured environments) ─────────────── */

async function checkWithFirestore(
  key:         string,
  maxRequests: number,
  windowMs:    number,
): Promise<RateLimitResult> {
  const { checkRateLimit: fsCheck } = await import('./rateLimitFirestore');
  const result = await fsCheck(key, maxRequests, windowMs);
  return {
    ...result,
    limit: maxRequests,
    reset: Date.now() + windowMs,
  };
}

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Check the rate limit for `key`.
 * Uses Redis if configured, Firestore otherwise.
 *
 * @param key         e.g. `"ai-estimate:1.2.3.4"` or `"ai-estimate:uid123"`
 * @param maxRequests Max requests allowed in the window
 * @param windowMs    Window length in milliseconds (default: 60 000)
 */
export async function checkRateLimit(
  key:         string,
  maxRequests = 10,
  windowMs    = 60_000,
): Promise<RateLimitResult> {
  try {
    if (isRedisConfigured()) {
      return await checkWithRedis(key, maxRequests, windowMs);
    }
    return await checkWithFirestore(key, maxRequests, windowMs);
  } catch (err) {
    // Always fail open — never block a user because rate limiting is down
    console.error('[RateLimit] Error — failing open:', (err as Error).message);
    return { allowed: true, remaining: -1, limit: maxRequests, retryAfter: 0, reset: 0 };
  }
}

/** Standard rate-limit response headers (X-RateLimit-*, Retry-After). */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit':     String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    ...(result.retryAfter > 0 ? { 'Retry-After': String(result.retryAfter) } : {}),
  };
}

/** Pre-built 429 Response with standard headers. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      ok:    false,
      error: 'Demasiadas solicitudes. Espera un momento.',
      code:  'RATE_LIMITED',
    }),
    {
      status:  429,
      headers: {
        'Content-Type': 'application/json',
        ...rateLimitHeaders(result),
      },
    },
  );
}
