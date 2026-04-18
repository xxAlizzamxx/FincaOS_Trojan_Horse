/**
 * Lightweight in-process event bus.
 *
 * Design decisions:
 *  - Handlers are fire-and-forget (Promise errors never crash the caller)
 *  - No external dependencies (just Node.js)
 *  - Typed via discriminated union (AppEvent)
 *  - Returns unsubscribe fn from on()
 *
 * This is intentionally simple. If you need durable events / retries / fan-out
 * across services, upgrade to Firestore events collection or a message queue.
 *
 * Usage:
 *   import { eventBus } from '@/events/emitter';
 *
 *   // Emit
 *   eventBus.emit({ type: 'incidencia.created', timestamp: iso, payload: {...} });
 *
 *   // Subscribe
 *   const unsub = eventBus.on('incidencia.created', (e) => console.log(e.payload));
 *   // later: unsub();
 */

import type { AppEvent, AppEventType } from './types';

type Handler<E extends AppEvent = AppEvent> = (event: E) => void | Promise<void>;

class AppEventEmitter {
  private readonly handlers = new Map<AppEventType, Handler[]>();

  /**
   * Register a handler for a specific event type.
   * @returns Unsubscribe function — call it to remove the handler.
   */
  on<E extends AppEvent>(type: E['type'], handler: Handler<E>): () => void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler as Handler]);

    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(type, current.filter((h) => h !== (handler as Handler)));
    };
  }

  /**
   * Emit an event to all registered handlers.
   *
   * - Never throws (handler errors are caught and logged)
   * - Fire-and-forget (async handlers run without blocking the caller)
   */
  emit<E extends AppEvent>(event: E): void {
    const handlers = this.handlers.get(event.type) ?? [];

    for (const handler of handlers) {
      Promise.resolve(handler(event as never)).catch((err: unknown) => {
        // Handler failure must never crash the request
        console.error(
          JSON.stringify({
            level:      'error',
            action:     'event_handler_failed',
            event_type: event.type,
            error:      err instanceof Error ? err.message : String(err),
            timestamp:  new Date().toISOString(),
          }),
        );
      });
    }
  }

  /** Number of registered handlers across all event types (useful for tests). */
  get handlerCount(): number {
    let n = 0;
    for (const list of this.handlers.values()) n += list.length;
    return n;
  }
}

/** Singleton event bus — import and use from anywhere in server code. */
export const eventBus = new AppEventEmitter();
