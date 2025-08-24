// ABOUTME: Custom wrapper around Next.js standalone server with enhanced CLI options
// ABOUTME: Provides auto-port detection, browser opening, and better UX around standalone build

import { parseServerArgs, showHelpAndExit, showSecurityWarning } from './lib/server/cli-utils';
import { validatePort, findAvailablePort } from './lib/server/port-utils';
import { openBrowser, shouldOpenBrowser } from './lib/server/browser-utils';
import { startNextServer, setupStandaloneConfig } from './lib/server/next-server';

// Parse command line arguments
const args = parseServerArgs();

if (args.help) {
  showHelpAndExit();
}

const { port: requestedPort, userSpecified: userSpecifiedPort } = validatePort(args.port, 31337);
const hostname = args.host;

// Interactive detection and browser opening
const shouldOpen = shouldOpenBrowser();

// Security warning for non-localhost binding
showSecurityWarning(hostname);

// Detect if we're running in development or production (standalone) mode
const isDev = process.env.NODE_ENV !== 'production';
const useTurbopack = process.env.TURBOPACK === '1' || process.env.TURBOPACK === 'true';

// Only set production environment if not already set
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = isDev ? 'development' : 'production';
}

// Setup standalone configuration when running the server
setupStandaloneConfig();

// Our enhanced server that replaces the standalone server
async function startLaceServer() {
  // Do our port detection first
  const port = await findAvailablePort(requestedPort, userSpecifiedPort, hostname);
  const url = `http://${hostname}:${port}`;

  // eslint-disable-next-line no-console -- Server startup message is appropriate for server process
  console.log(`🚀 Starting Lace server on ${url}...`);

  try {
    // Start the Next.js server
    await startNextServer({
      port,
      hostname,
      isDev,
      useTurbopack,
    });

    // Open browser if running interactively
    if (shouldOpen) {
      await openBrowser(url);
    }
  } catch (error) {
    throw new Error(`Failed to start server on ${url}: ${error}`);
  }
}

// Only start the server if this file is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startLaceServer().catch((err) => {
    console.error('Error starting server:', err);
    process.exit(1);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  // eslint-disable-next-line no-console -- Shutdown message is appropriate for server process lifecycle
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  // eslint-disable-next-line no-console -- Shutdown message is appropriate for server process lifecycle
  console.log('\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});
