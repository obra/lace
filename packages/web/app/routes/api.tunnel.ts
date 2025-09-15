// ABOUTME: Sentry tunnel endpoint to avoid CORS issues in development
// ABOUTME: Routes Sentry requests through our domain to prevent cross-origin blocking

import { logger } from '~/utils/logger';
import type { Route } from './+types/api.tunnel';

const SENTRY_HOST = 'o4508888512331776.ingest.us.sentry.io';
const SENTRY_PROJECT_ID = '4510016051019776';

export async function action({ request }: Route.ActionArgs) {
  switch (request.method) {
    case 'POST':
      break;
    default:
      return new Response('Method not allowed', { status: 405 });
  }

  try {
    logger.debug('🔄 Sentry tunnel request received');

    const envelope = await request.text();
    logger.debug('📦 Sentry envelope received', {
      size: envelope.length,
    });

    const pieces = envelope.split('\n');
    const header = JSON.parse(pieces[0]) as { dsn?: string; trace?: unknown; event_id?: string };

    logger.debug('📋 Sentry envelope header parsed', {
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
      // Extract the public key from the DSN if present
      let publicKey = '7d7d2eed251df30b06eb8c7cdc81f221';
      if (header.dsn) {
        const match = header.dsn.match(/https:\/\/([a-f0-9]{32})@/);
        if (match) {
          publicKey = match[1];
        }
      }
      const timestamp = Math.floor(Date.now() / 1000);

      // Use fetch directly instead of api client for raw envelope forwarding
      const response = await fetch(sentryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_key=${publicKey}, sentry_version=7, sentry_timestamp=${timestamp}, sentry_client=sentry.javascript.react-router`,
        },
        body: envelope,
      });

      if (!response.ok) {
        const text = await response.text();
        logger.warn('🔴 Sentry error response', {
          status: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`,
          body: text,
        });
        return new Response(text, { status: response.status });
      }

      logger.debug('✅ Sentry envelope forwarded successfully');
      return new Response(null, { status: 200 });
    } catch (error) {
      // Handle fetch errors
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
