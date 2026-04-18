/**
 * Upstash Redis client — singleton, safe for serverless cold starts.
 *
 * SETUP:
 *   1. Create a free serverless Redis DB at https://upstash.com
 *   2. Add to .env.local (and Vercel env vars):
 *      UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *      UPSTASH_REDIS_REST_TOKEN=AXxx...
 *
 * Install: npm install @upstash/redis
 */

import { Redis } from '@upstash/redis';

let _client: Redis | null = null;

/**
 * Returns the singleton Redis client.
 * Throws a clear error if env vars are missing (fail-fast in development).
 */
export function getRedis(): Redis {
  if (_client) return _client;

  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[Redis] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.\n' +
      'Create a free Redis DB at https://upstash.com and add the credentials to .env.local',
    );
  }

  _client = new Redis({ url, token });
  return _client;
}

/** Returns true if Redis is configured in this environment. */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
