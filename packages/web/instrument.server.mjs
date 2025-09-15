// ABOUTME: Sentry server-side instrumentation for React Router v7
// ABOUTME: Must be imported before any other modules via NODE_OPTIONS

import * as Sentry from "@sentry/react-router";

Sentry.init({
  dsn: "https://7d7d2eed251df30b06eb8c7cdc81f221@o4508888512331776.ingest.us.sentry.io/4510016051019776",

  // Enable sending default PII
  sendDefaultPii: true,

  // Ignore tunnel and noisy transactions
  ignoreTransactions: [
    '/api/tunnel',
    '/api/events/stream',
    '/_favicon.ico',
  ],

  // Filter out tunnel-related errors
  beforeSend(event, _hint) {
    // Ignore errors from the tunnel endpoint
    if (event.request?.url?.includes('/api/tunnel')) {
      return null;
    }
    // Ignore common network errors
    if (event.exception) {
      const error = event.exception.values?.[0];
      if (error?.type === 'ECONNRESET' || error?.type === 'ENOTFOUND') {
        return null;
      }
    }
    return event;
  },

  // Filter transactions
  beforeSendTransaction(event) {
    // Ignore tunnel and other noisy transactions
    if (event.transaction?.includes('/api/tunnel') ||
        event.transaction?.includes('/api/events/stream')) {
      return null;
    }
    return event;
  },
});