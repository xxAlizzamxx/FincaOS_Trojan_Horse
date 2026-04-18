/**
 * Typed error hierarchy + consistent API response shape.
 *
 * Every API route should:
 *   1. throw typed errors (AuthError, ValidationError, etc.)
 *   2. wrap the handler in withHandler() from lib/apiHandler.ts
 *      which calls handleApiError() in the catch block.
 *
 * Frontend receives: { ok: false, error: string, code: string, details?: unknown }
 */

import { NextResponse } from 'next/server';
import type { Logger }  from './logger';

/* ── Typed error hierarchy ─────────────────────────────────────────────── */

export class AppError extends Error {
  readonly code:       string;
  readonly statusCode: number;
  readonly details?:   unknown;

  constructor(message: string, code: string, statusCode: number, details?: unknown) {
    super(message);
    this.name       = 'AppError';
    this.code       = code;
    this.statusCode = statusCode;
    this.details    = details;
  }
}

export class AuthError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 'AUTH_ERROR', 401);
  }
}

export class TokenError extends AppError {
  constructor() {
    super('Token inválido o expirado', 'TOKEN_INVALID', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Sin permisos para esta acción') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} no encontrado`, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(
      `Demasiadas solicitudes. Reintenta en ${retryAfter}s`,
      'RATE_LIMITED',
      429,
      { retry_after: retryAfter },
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
  }
}

export class StripeError extends AppError {
  constructor(message: string) {
    super(message, 'STRIPE_ERROR', 500);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Error interno del servidor') {
    super(message, 'INTERNAL_ERROR', 500);
  }
}

/* ── Standard response helpers ─────────────────────────────────────────── */

export function okResponse<T>(data?: T, status = 200): NextResponse {
  return NextResponse.json(
    { ok: true, ...(data !== undefined ? { data } : {}) },
    { status },
  );
}

export function errResponse(
  message: string,
  code:    string,
  status:  number,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: message, code, ...(details !== undefined ? { details } : {}) },
    { status },
  );
}

/* ── Global error handler ──────────────────────────────────────────────── */

/**
 * Converts any thrown value into a typed NextResponse.
 * Call this in the catch block of every API route (or use withHandler()).
 */
export function handleApiError(error: unknown, log?: Logger): NextResponse {
  if (error instanceof AppError) {
    // 4xx = warn, 5xx = error
    if (error.statusCode >= 500) {
      log?.error('app_error', error, { code: error.code });
      captureException(error);
    } else {
      log?.warn('app_error', { code: error.code, message: error.message, status: error.statusCode });
    }
    return errResponse(error.message, error.code, error.statusCode, error.details);
  }

  // Unexpected / untyped error
  log?.error('unexpected_error', error);
  captureException(error);
  return errResponse('Error interno del servidor', 'INTERNAL_ERROR', 500);
}

/* ── Optional Sentry (lazy — app never crashes if Sentry is not installed) */

function captureException(err: unknown): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs');
    Sentry.captureException(err);
  } catch {
    // Sentry not installed — silently skip
  }
}
