/**
 * Sentry — client-side configuration.
 *
 * SETUP:
 *   npm install @sentry/nextjs
 *   Add to .env.local: NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/yyy
 *   Run: npx @sentry/wizard@latest -i nextjs
 *     (auto-patches next.config.js with withSentryConfig wrapper)
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of sessions as performance traces in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Capture 10% of sessions for replays (only on errors)
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.05,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text and inputs for privacy
      maskAllText:   true,
      blockAllMedia: false,
    }),
  ],

  // Disable in development — no noise during local work
  enabled: process.env.NODE_ENV === 'production',

  // Never send PII (email, address, etc.)
  sendDefaultPii: false,

  environment: process.env.NODE_ENV ?? 'development',
});
