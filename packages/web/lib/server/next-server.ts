// ABOUTME: Next.js server management utilities
// ABOUTME: Handles Next.js server configuration and startup for standalone builds

import path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from 'next/dist/server/lib/start-server';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
