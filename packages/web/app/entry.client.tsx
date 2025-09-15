// ABOUTME: Client-side entry point for React Router v7 SPA mode
// ABOUTME: Hydrates the application on the client side only

import * as Sentry from '@sentry/react-router';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

import './globals.css';

// Initialize Sentry for client-side error tracking
Sentry.init({
  dsn: 'https://7d7d2eed251df30b06eb8c7cdc81f221@o4508888512331776.ingest.us.sentry.io/4510016051019776',

  // Enable debug mode to see what's happening
  debug: false,

  // Adds request headers and IP for users
  sendDefaultPii: true,

  integrations: [
    // User Feedback
    Sentry.feedbackIntegration({
      colorScheme: 'system',
    }),
  ],

  // Use tunnel to avoid CORS issues
  tunnel: '/api/tunnel',

  // Ignore tunnel requests and other noise
  ignoreTransactions: ['/api/tunnel', '/api/events/stream', '/_favicon.ico'],

  // Filter out tunnel-related errors
  beforeSend(event, _hint) {
    // Ignore errors from the tunnel endpoint
    if (event.request?.url?.includes('/api/tunnel')) {
      return null;
    }
    return event;
  },

  // Filter transactions
  beforeSendTransaction(event) {
    // Ignore tunnel and other noisy transactions
    if (
      event.transaction?.includes('/api/tunnel') ||
      event.transaction?.includes('/api/events/stream')
    ) {
      return null;
    }
    return event;
  },
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
