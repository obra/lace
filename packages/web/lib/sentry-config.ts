// ABOUTME: Central Sentry configuration constants
// ABOUTME: Single source of truth for Sentry DSN and shared settings

export const SENTRY_DSN =
  'https://886230dfd5ba5600e8cc8db8710f2448@o543459.ingest.us.sentry.io/4509844023279616';

export const SENTRY_CONFIG = {
  dsn: SENTRY_DSN,
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Only enable debug in development and if we have a debug bundle
  debug: process.env.NODE_ENV === 'development' && process.env.SENTRY_DEBUG === 'true',
  environment: process.env.NODE_ENV,

  // Use tunnel to avoid CORS issues in development
  tunnel: process.env.NODE_ENV === 'development' ? '/api/tunnel' : undefined,

  // Configure trace propagation to avoid unwanted CORS preflight requests
  tracePropagationTargets: [
    'localhost',
    /^\/api\//, // Same-origin API calls only
  ],
};
