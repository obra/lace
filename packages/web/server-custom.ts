// ABOUTME: Custom wrapper around Next.js standalone server with enhanced CLI options
// ABOUTME: Provides auto-port detection, browser opening, and better UX around standalone build

import {
  parseServerArgs,
  showHelpAndExit,
  showSecurityWarning,
  validatePort,
  findAvailablePort,
  openBrowser,
  shouldOpenBrowser,
} from './lib/server/dependencies';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from 'next/dist/server/lib/start-server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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

/**
 * Sets up standalone Next.js configuration
 * Only runs when the server is actually starting, not during imports
 */
export function setupStandaloneConfig(): void {
  const isStandalone = process.env.NODE_ENV === 'production';

  if (!isStandalone) {
    return;
  }

  const nextConfig = {
    env: {},
    eslint: { ignoreDuringBuilds: false, dirs: ['app', 'components', 'lib'] },
    typescript: { ignoreBuildErrors: false, tsconfigPath: 'tsconfig.json' },
    distDir: './.next',
    cleanDistDir: true,
    assetPrefix: '',
    cacheMaxMemorySize: 52428800,
    configOrigin: 'next.config.ts',
    useFileSystemPublicRoutes: true,
    generateEtags: true,
    pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
    poweredByHeader: true,
    compress: true,
    // ... rest of Next.js config would go here
    output: 'standalone',
    outputFileTracingRoot: process.cwd(),
  };

  // Set the Next.js private config environment variable for standalone mode
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
}

/**
 * Starts the Next.js server with enhanced configuration
 */
export async function startNextServer(options: {
  port: number;
  hostname: string;
  isDev: boolean;
  useTurbopack?: boolean;
}): Promise<void> {
  const { port, hostname, isDev, useTurbopack } = options;

  // Determine web directory based on environment
  const webDir = isDev
    ? path.resolve(__dirname, '../..')
    : path.join(path.resolve(__dirname, '../../../..'), 'packages/web');

  try {
    await startServer({
      dir: webDir,
      isDev: isDev,
      hostname: hostname,
      port: port,
      allowRetry: false,
      keepAliveTimeout: undefined,
      ...(useTurbopack && isDev && { turbopack: true }),
    });

    // eslint-disable-next-line no-console -- Server ready message with URL/PID is appropriate for server process
    console.log(`
✅ Lace is ready!
   
   🌐 URL: http://${hostname}:${port}
   🔒 PID: ${process.pid}
   
   Press Ctrl+C to stop
`);

    // Signal the actual port to parent process (for menu bar app)
    // eslint-disable-next-line no-console -- Port/URL signaling required for parent process communication
    console.log(`LACE_SERVER_PORT:${port}`);
    // eslint-disable-next-line no-console -- Port/URL signaling required for parent process communication
    console.log(`LACE_SERVER_URL:http://${hostname}:${port}`);
  } catch (error) {
    throw new Error(`Failed to start server on http://${hostname}:${port}: ${error}`);
  }
}
