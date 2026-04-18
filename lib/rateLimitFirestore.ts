/**
 * Distributed rate limiter backed by Firestore.
 * Correct across multiple serverless instances / cold starts.
 *
 * SETUP (one-time, Firebase Console):
 *   Firestore → Indexes → TTL Policies → Add
 *   Collection: _rate_limits   Field: expires_at   (Timestamp)
 *   This auto-deletes expired docs so the collection stays small.
 */

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

/** Lazy-init: safe to call from any server module. */
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;  // -1 means unknown (Firestore error, fail-open)
  retryAfter: number;  // seconds; 0 if request is allowed
}

/**
 * Atomically checks and increments the rate-limit counter for `key`.
 * Uses a Firestore transaction — safe under concurrent serverless invocations.
 *
 * @param key         Unique identifier, e.g. `"ai-estimate:1.2.3.4"`
 * @param maxRequests Max requests in the window (inclusive)
 * @param windowMs    Sliding window in milliseconds (default: 60 000)
 */
export async function checkRateLimit(
  key: string,
  maxRequests = 10,
  windowMs    = 60_000,
): Promise<RateLimitResult> {
  // Firestore doc IDs may not contain '/'
  const docId = key.replace(/[^a-zA-Z0-9_:\-.]/g, '_').slice(0, 1_500);
  const db    = getDb();
  const ref   = db.collection('_rate_limits').doc(docId);
  const now   = Date.now();

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists || (snap.data()!.reset as number) <= now) {
        // New or expired window — start fresh
        const resetAt = now + windowMs;
        tx.set(ref, {
          count:      1,
          reset:      resetAt,
          // Firestore TTL field — must be a Timestamp
          expires_at: Timestamp.fromMillis(resetAt + 120_000),
        });
        return { allowed: true, remaining: maxRequests - 1, retryAfter: 0 };
      }

      const { count, reset } = snap.data() as { count: number; reset: number };

      if (count >= maxRequests) {
        return {
          allowed:    false,
          remaining:  0,
          retryAfter: Math.max(1, Math.ceil((reset - now) / 1_000)),
        };
      }

      tx.update(ref, { count: FieldValue.increment(1) });
      return { allowed: true, remaining: maxRequests - count - 1, retryAfter: 0 };
    });

    return result;
  } catch (err) {
    // Fail open: never block a request because our rate limiter is down.
    console.error('[RateLimit] Firestore error — failing open:', (err as Error).message);
    return { allowed: true, remaining: -1, retryAfter: 0 };
  }
}

/** Convenience: build a 429 response with standard headers. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: 'Demasiadas solicitudes. Espera un momento.' }),
    {
      status:  429,
      headers: {
        'Content-Type':          'application/json',
        'Retry-After':           String(result.retryAfter),
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}
