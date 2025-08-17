// ABOUTME: Sentry tunnel endpoint to avoid CORS issues in development
// ABOUTME: Routes Sentry requests through our domain to prevent cross-origin blocking
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '~/utils/logger';

const SENTRY_HOST = 'o543459.ingest.us.sentry.io';
const SENTRY_PROJECT_ID = '4509844023279616';

export async function POST(request: NextRequest) {
  try {
    logger.info('🔄 Sentry tunnel request received');
    
    const envelope = await request.text();
    logger.debug('📦 Sentry envelope received', {
      size: envelope.length,
      preview: envelope.substring(0, 200) + (envelope.length > 200 ? '...' : '')
    });
    
    const pieces = envelope.split('\n');
    const header = JSON.parse(pieces[0]);
    
    logger.debug('📋 Sentry envelope header parsed', {
      dsn: header?.dsn,
      trace: header?.trace,
      event_id: header?.event_id,
    });
    
    // Only forward envelopes for our project
    if (header?.dsn) {
      const dsnUrl = new URL(header.dsn);
      logger.debug('🔍 DSN validation', {
        hostname: dsnUrl.hostname,
        expected: SENTRY_HOST,
        valid: dsnUrl.hostname.includes(SENTRY_HOST)
      });
      
      if (!dsnUrl.hostname.includes(SENTRY_HOST)) {
        logger.warn('❌ Invalid DSN rejected', { hostname: dsnUrl.hostname });
        return new NextResponse('Invalid DSN', { status: 400 });
      }
    }

    // Forward to Sentry
    const sentryUrl = `https://${SENTRY_HOST}/api/${SENTRY_PROJECT_ID}/envelope/`;
    logger.debug('🚀 Forwarding to Sentry', { url: sentryUrl });
    
    const sentryResponse = await fetch(sentryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
      },
      body: envelope,
    });

    // Log response details, including error body for non-200 responses
    const responseLog: any = {
      status: sentryResponse.status,
      statusText: sentryResponse.statusText,
      headers: Object.fromEntries(sentryResponse.headers.entries())
    };

    // If error response, try to get the error details
    if (sentryResponse.status >= 400) {
      try {
        const errorBody = await sentryResponse.text();
        responseLog.errorBody = errorBody;
        logger.warn('🔴 Sentry error response', responseLog);
      } catch (e) {
        logger.warn('🔴 Sentry error response (could not read body)', responseLog);
      }
    } else {
      logger.info('✅ Sentry response received', responseLog);
    }

    return new NextResponse(null, {
      status: sentryResponse.status,
    });
  } catch (error) {
    logger.error('💥 Sentry tunnel error occurred', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return new NextResponse('Tunnel error', { status: 500 });
  }
}