// ABOUTME: Client-side Sentry instrumentation for Next.js 15+ compatibility  
// ABOUTME: Replaces sentry.client.config.ts to work with Turbopack and avoid deprecation warnings
import * as Sentry from '@sentry/nextjs';
import { SENTRY_CONFIG } from './lib/sentry-config';

// Export navigation instrumentation hook for Next.js App Router
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

export function onClientInit() {
  Sentry.init({
    ...SENTRY_CONFIG,

    // Capture Replay for 10% of all sessions,
    // plus for 100% of sessions with an error
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.replayIntegration({
        // Additional Replay configuration goes in here, for example:
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    beforeSend(event, hint) {
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
}