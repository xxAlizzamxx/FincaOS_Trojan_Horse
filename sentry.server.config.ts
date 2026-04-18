/**
 * Sentry — server-side configuration (Node.js / Edge runtime).
 * Automatically captures unhandled exceptions in API routes.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Keep server traces low to avoid quota burn
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,

  enabled: process.env.NODE_ENV === 'production',

  sendDefaultPii: false,

  environment: process.env.NODE_ENV ?? 'development',

  // Ignore noisy non-actionable errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
  ],
});
