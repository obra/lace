// ABOUTME: API route for testing server-side Sentry error reporting
// ABOUTME: Throws a test error when called to verify Sentry captures server errors

import * as Sentry from '@sentry/node';

export async function action({ request }: { request: Request }) {
  // Add method guard
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Capture a message first
    Sentry.captureMessage('Test server API called', 'info');

    // Then throw an error to test error reporting
    throw new Error('Test server-side error for Sentry');
  } catch (error: unknown) {
    // Explicitly capture the caught error with Sentry.captureException so it is reported to Sentry
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.captureException(err);

    // Wait for the event to be sent before returning
    try {
      await Sentry.flush(2000);
    } catch {
      // Don't block if flush fails
    }

    return Response.json({ error: 'Test server error triggered' }, { status: 500 });
  }
}
