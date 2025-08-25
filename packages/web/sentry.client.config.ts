// ABOUTME: Client-side Sentry configuration for error tracking in browser
// ABOUTME: Captures client-side errors, performance data, and user interactions
import * as Sentry from '@sentry/react';
import { SENTRY_CONFIG } from './lib/sentry-config';

Sentry.init({
  ...SENTRY_CONFIG,

  integrations: [
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  beforeSend(event, _hint) {
    // Filter out known harmless errors or add context
    if (event.exception) {
      const error = event.exception.values?.[0];
      if (error?.type === 'ChunkLoadError') {
        // These are common in SPAs and usually not actionable
        return null;
      }
    }
    return event;
  },
});
