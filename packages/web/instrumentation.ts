// ABOUTME: Next.js 15 instrumentation hook for server initialization
// ABOUTME: Initializes logging configuration from environment variables

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize Sentry first, then logging, then LACE_DIR
    await import('./sentry.server.config');
    await import('./lib/server/logging-init');
    await import('./lib/server/data-dir-init');

    // Import server dependencies to ensure Next.js NFT traces them
    // This ensures our custom server's deps are included in standalone builds
    await import('./lib/server/dependencies');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// New Next.js 15 error handling hook for logging errors across all runtimes
export async function onRequestError(
  err: Error,
  request: Request,
  context: { routerKind: string }
) {
  // This works in both Node.js and Edge runtime
  console.error('Next.js Request Error:', {
    message: err.message,
    url: request.url,
    runtime: process.env.NEXT_RUNTIME,
    context,
  });
}
