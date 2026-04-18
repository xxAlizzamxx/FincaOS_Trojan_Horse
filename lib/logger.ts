/**
 * Structured logger for API routes.
 *
 * Output: JSON lines — ingested natively by Vercel Logs, Datadog, Loki, etc.
 * Every log line includes: level, timestamp, request_id, route, user_id?, action, ...data
 *
 * Usage:
 *   const log = createLogger({ route: '/api/incidencias/afectar', userId: uid, requestId });
 *   log.info('quorum_calculated', { afectados: 5, pct: 31.2 });
 *   log.error('db_write_failed', err);
 *   log.finish(true, 200);          // logs latency_ms
 */

export interface LogContext {
  route:      string;
  userId?:    string;
  requestId?: string;
}

export interface Logger {
  readonly requestId: string;
  readonly startTime: number;
  info:   (action: string, data?: Record<string, unknown>) => void;
  warn:   (action: string, data?: Record<string, unknown>) => void;
  error:  (action: string, err?: unknown, data?: Record<string, unknown>) => void;
  finish: (success: boolean, statusCode?: number) => void;
  /** Returns a child logger scoped to a sub-action (same requestId). */
  child:  (subContext: Partial<LogContext>) => Logger;
}

/* ── Internals ─────────────────────────────────────────────────────────── */

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}

function write(level: 'info' | 'warn' | 'error', payload: Record<string, unknown>) {
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/* ── Public factory ────────────────────────────────────────────────────── */

export function createLogger(context: LogContext): Logger {
  const requestId = context.requestId ?? crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  const base = (): Record<string, unknown> => ({
    timestamp:  new Date().toISOString(),
    request_id: requestId,
    route:      context.route,
    ...(context.userId ? { user_id: context.userId } : {}),
  });

  const logger: Logger = {
    requestId,
    startTime,

    info(action, data = {}) {
      write('info', { ...base(), level: 'info', action, ...data });
    },

    warn(action, data = {}) {
      write('warn', { ...base(), level: 'warn', action, ...data });
    },

    error(action, err, data = {}) {
      write('error', {
        ...base(),
        level: 'error',
        action,
        ...(err !== undefined ? { error: serializeError(err) } : {}),
        ...data,
      });
    },

    finish(success, statusCode) {
      const level = success ? 'info' : 'warn';
      write(level, {
        ...base(),
        level,
        action:      'request_complete',
        success,
        status_code: statusCode,
        latency_ms:  Date.now() - startTime,
      });
    },

    child(subContext) {
      return createLogger({
        route:     subContext.route  ?? context.route,
        userId:    subContext.userId ?? context.userId,
        requestId,
      });
    },
  };

  return logger;
}
