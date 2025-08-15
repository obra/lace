// ABOUTME: Sentry client-side configuration for browser error tracking and performance monitoring.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://606f2de5902585552440017e29d87bef@o543459.ingest.us.sentry.io/4509844024786944',

  integrations: [
    // Send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
    Sentry.replayIntegration({
      // Capture replays on errors and 10% of sessions
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  // Performance monitoring
  tracesSampleRate: 1.0,

  // Replay sampling
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

  // Enable logs
  _experiments: {
    enableLogs: true,
  },

  // Environment configuration
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  beforeSend(event) {
    // Filter out noise in development
    if (process.env.NODE_ENV === 'development') {
      // Skip certain errors that are common in development
      if (event.exception?.values?.[0]?.value?.includes('Network Error')) {
        return null;
      }
    }
    return event;
  },
});
