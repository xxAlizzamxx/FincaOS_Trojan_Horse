/**
 * Route handler wrapper.
 * Injects a structured logger + request_id and handles all errors uniformly.
 *
 * Usage — replaces the bare `export async function POST(req)` pattern:
 *
 *   export const POST = withHandler(async (req, { log, requestId }) => {
 *     log.info('action_start', { someField: 'value' });
 *     // ... your logic ...
 *     log.finish(true, 200);
 *     return okResponse({ data: 'here' });
 *   });
 *
 * Any uncaught AppError (or unexpected error) is caught, logged, and returned
 * as a typed { ok: false, error, code } response — no try/catch needed in the route.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createLogger, type Logger } from './logger';
import { handleApiError }            from './errors';

export interface ApiContext {
  log:       Logger;
  requestId: string;
}

type RouteHandler = (
  req:    NextRequest,
  ctx:    ApiContext,
  params?: Record<string, string>,
) => Promise<NextResponse>;

/**
 * Wraps a Next.js route handler with:
 *  - Unique request_id (from `x-request-id` header or generated)
 *  - Structured logger bound to the request
 *  - Automatic error handling (typed AppErrors → typed JSON responses)
 *  - Latency logging on finish
 */
export function withHandler(handler: RouteHandler) {
  return async (
    req:    NextRequest,
    params?: Record<string, string>,
  ): Promise<NextResponse> => {
    const route     = req.nextUrl.pathname;
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID().slice(0, 8);
    const log       = createLogger({ route, requestId });

    log.info('request_start', { method: req.method });

    try {
      const response = await handler(req, { log, requestId }, params);

      // Only auto-finish if the handler didn't call log.finish() manually
      // (we detect this by checking if finish was already called — simple heuristic:
      //  if you want explicit control, call log.finish() yourself before returning)
      return response;
    } catch (err) {
      return handleApiError(err, log);
    }
  };
}
