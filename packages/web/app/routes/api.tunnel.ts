// ABOUTME: Sentry tunnel endpoint to avoid CORS issues in development
// ABOUTME: Routes Sentry requests through our domain to prevent cross-origin blocking

import { logger } from '~/utils/logger';
import type { Route } from './+types/api.tunnel';
import { api } from '@/lib/api-client';

const SENTRY_HOST = 'o543459.ingest.us.sentry.io';
const SENTRY_PROJECT_ID = '4509844023279616';

export async function action({ request }: Route.ActionArgs) {
  switch (request.method) {
    case 'POST':
      break;
    default:
      return new Response('Method not allowed', { status: 405 });
  }

  try {
    logger.info('🔄 Sentry tunnel request received');

    const envelope = await request.text();
    logger.debug('📦 Sentry envelope received', {
      size: envelope.length,
      preview: envelope.substring(0, 200) + (envelope.length > 200 ? '...' : ''),
    });

    const pieces = envelope.split('\n');
    const header = JSON.parse(pieces[0]) as { dsn?: string; trace?: unknown; event_id?: string };

    logger.debug('📋 Sentry envelope header parsed', {
      dsn: header.dsn,
      trace: header.trace,
      event_id: header.event_id,
    });

    // Only forward envelopes for our project
    if (header.dsn) {
      const dsnUrl = new URL(header.dsn);
      logger.debug('🔍 DSN validation', {
        hostname: dsnUrl.hostname,
        expected: SENTRY_HOST,
        valid: dsnUrl.hostname.includes(SENTRY_HOST),
      });

      if (!dsnUrl.hostname.includes(SENTRY_HOST)) {
        logger.warn('❌ Invalid DSN rejected', { hostname: dsnUrl.hostname });
        return new Response('Invalid DSN', { status: 400 });
      }
    }

    // Forward to Sentry
    const sentryUrl = `https://${SENTRY_HOST}/api/${SENTRY_PROJECT_ID}/envelope/`;
    logger.debug('🚀 Forwarding to Sentry', { url: sentryUrl });

    try {
      // Use api client for the request - it will handle errors properly
      // Note: Passing the envelope as the body, overriding content-type for Sentry format
      await api.post<void>(sentryUrl, envelope, {
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
        },
      });

      logger.info('✅ Sentry envelope forwarded successfully');
      return new Response(null, { status: 200 });
    } catch (error) {
      // Api client throws structured errors - handle HttpError for status codes
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        const httpError = error as { status: number; message: string };
        logger.warn('🔴 Sentry error response', {
          status: httpError.status,
          message: httpError.message,
        });
        return new Response(null, { status: httpError.status });
      }

      // Handle other error types (NetworkError, ParseError, etc.)
      logger.warn('🔴 Sentry forwarding failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response(null, { status: 500 });
    }
  } catch (error) {
    logger.error('💥 Sentry tunnel error occurred', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response('Tunnel error', { status: 500 });
  }
}
