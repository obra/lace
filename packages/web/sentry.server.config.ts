// ABOUTME: Server-side Sentry configuration for Node.js runtime error tracking
// ABOUTME: Captures server errors, API route errors, and performance data
import * as Sentry from '@sentry/node';
import { SENTRY_CONFIG } from './lib/sentry-config';

Sentry.init({
  ...SENTRY_CONFIG,

  beforeSend(event, _hint) {
    // Filter out known harmless errors or add context
    if (event.exception) {
      const error = event.exception.values?.[0];
      if (error?.type === 'ECONNRESET' || error?.type === 'ENOTFOUND') {
        // Network errors are often not actionable for desktop apps
        return null;
      }
    }
    return event;
  },
});
