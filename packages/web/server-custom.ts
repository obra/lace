// ABOUTME: Custom wrapper around Next.js standalone server with enhanced CLI options
// ABOUTME: Provides auto-port detection, browser opening, and better UX around standalone build

import { parseArgs } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import module from 'module';

// Parse command line arguments
const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      short: 'p',
    },
    host: {
      type: 'string',
      short: 'h',
      default: 'localhost',
    },
    help: {
      type: 'boolean',
      default: false,
    },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Lace Web Server

Usage: npm start -- [options]

Options:
  -p, --port <port>    Port to listen on (default: 31337, auto-finds available)
  -h, --host <host>    Host to bind to (default: localhost)
                       Use '0.0.0.0' to allow external connections
  --help               Show this help message

Examples:
  npm start                        # Start on localhost:31337 (or next available)
  npm start -- --port 8080         # Start on localhost:8080 (exact port required)
  npm start -- --host 0.0.0.0      # Allow external connections
  npm run dev -- --port 3001       # Development mode on port 3001 (exact port)
`);
  process.exit(0);
}

const userSpecifiedPort = !!values.port; // Track if user manually specified port
const requestedPort = parseInt(values.port || '31337', 10);
const hostname = values.host || 'localhost';

// Detect if running interactively (both stdin and stdout are TTYs)
export function isInteractive(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout
): boolean {
  return !!(stdin.isTTY && stdout.isTTY);
}

const shouldOpenBrowser = isInteractive();

// Validate port
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  console.error(`Error: Invalid port number: "${values.port}" (parsed as ${requestedPort})`);
  process.exit(1);
}

// Security warning for non-localhost binding
if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
  console.warn(`
⚠️  WARNING: Server will be accessible from external networks (binding to ${hostname})
   This may expose your local Lace instance to other devices on your network.
   Use 'localhost' to restrict access to this machine only.
`);
}

// Detect if we're running in development or production (standalone) mode
const isDev = process.env.NODE_ENV !== 'production';
const isStandalone = !isDev;

console.log(`Starting Lace in ${isDev ? 'development' : 'production'} mode...`);

// Setup Node.js module system for standalone build
const require = module.createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Only set production environment if not already set
if (!process.env.NODE_ENV) {
  (process.env as any).NODE_ENV = isStandalone ? 'production' : 'development';
}

// In standalone mode, change to the standalone root directory for proper module resolution
let webDir: string;
if (isStandalone) {
  const standaloneRoot = path.resolve(__dirname, '../..');
  process.chdir(standaloneRoot);
  webDir = path.join(standaloneRoot, 'packages/web');
  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Web directory: ${webDir}`);
} else {
  // In development mode, stay in the current directory
  webDir = __dirname;
  console.log(`Development mode - working directory: ${process.cwd()}`);
}

// Next.js configuration - only needed for standalone builds
let nextConfig: any = undefined;

if (isStandalone) {
  nextConfig = {
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
    images: {
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
      path: '/_next/image',
      loader: 'default',
      loaderFile: '',
      domains: [],
      disableStaticImages: false,
      minimumCacheTTL: 60,
      formats: ['image/webp'],
      dangerouslyAllowSVG: false,
      contentSecurityPolicy: "script-src 'none'; frame-src 'none'; sandbox;",
      contentDispositionType: 'attachment',
      remotePatterns: [],
      unoptimized: false,
    },
    devIndicators: { position: 'bottom-left' },
    onDemandEntries: { maxInactiveAge: 60000, pagesBufferLength: 5 },
    amp: { canonicalBase: '' },
    basePath: '',
    sassOptions: {},
    trailingSlash: false,
    i18n: null,
    productionBrowserSourceMaps: false,
    excludeDefaultMomentLocales: true,
    serverRuntimeConfig: {},
    publicRuntimeConfig: {},
    reactProductionProfiling: false,
    reactStrictMode: null,
    reactMaxHeadersLength: 6000,
    httpAgentOptions: { keepAlive: true },
    logging: {},
    expireTime: 31536000,
    staticPageGenerationTimeout: 60,
    output: 'standalone',
    modularizeImports: {
      '@mui/icons-material': { transform: '@mui/icons-material/{{member}}' },
      lodash: { transform: 'lodash/{{member}}' },
    },
    outputFileTracingRoot: '/Users/jesse/Documents/GitHub/lace/.worktrees/f-single-file-install',
    experimental: {
      nodeMiddleware: false,
      cacheLife: {
        default: { stale: 300, revalidate: 900, expire: 4294967294 },
        seconds: { stale: 0, revalidate: 1, expire: 60 },
        minutes: { stale: 300, revalidate: 60, expire: 3600 },
        hours: { stale: 300, revalidate: 3600, expire: 86400 },
        days: { stale: 300, revalidate: 86400, expire: 604800 },
        weeks: { stale: 300, revalidate: 604800, expire: 2592000 },
        max: { stale: 300, revalidate: 2592000, expire: 4294967294 },
      },
      cacheHandlers: {},
      cssChunking: true,
      multiZoneDraftMode: false,
      appNavFailHandling: false,
      prerenderEarlyExit: true,
      serverMinification: true,
      serverSourceMaps: false,
      linkNoTouchStart: false,
      caseSensitiveRoutes: false,
      clientSegmentCache: false,
      dynamicOnHover: false,
      preloadEntriesOnStart: true,
      clientRouterFilter: true,
      clientRouterFilterRedirects: false,
      fetchCacheKeyPrefix: '',
      middlewarePrefetch: 'flexible',
      optimisticClientCache: true,
      manualClientBasePath: false,
      cpus: 15,
      memoryBasedWorkersCount: false,
      imgOptConcurrency: null,
      imgOptTimeoutInSeconds: 7,
      imgOptMaxInputPixels: 268402689,
      imgOptSequentialRead: null,
      isrFlushToDisk: true,
      workerThreads: false,
      optimizeCss: false,
      nextScriptWorkers: false,
      scrollRestoration: false,
      externalDir: false,
      disableOptimizedLoading: false,
      gzipSize: true,
      craCompat: false,
      esmExternals: true,
      fullySpecified: false,
      swcTraceProfiling: false,
      forceSwcTransforms: false,
      largePageDataBytes: 128000,
      typedRoutes: false,
      typedEnv: false,
      parallelServerCompiles: false,
      parallelServerBuildTraces: false,
      ppr: false,
      authInterrupts: false,
      webpackMemoryOptimizations: false,
      optimizeServerReact: true,
      useEarlyImport: false,
      viewTransition: false,
      routerBFCache: false,
      staleTimes: { dynamic: 0, static: 300 },
      serverComponentsHmrCache: true,
      staticGenerationMaxConcurrency: 8,
      staticGenerationMinPagesPerWorker: 25,
      dynamicIO: false,
      inlineCss: false,
      useCache: false,
      optimizePackageImports: [
        'lucide-react',
        'date-fns',
        'lodash-es',
        'ramda',
        'antd',
        'react-bootstrap',
        'ahooks',
        '@ant-design/icons',
        '@headlessui/react',
        '@headlessui-float/react',
        '@heroicons/react/20/solid',
        '@heroicons/react/24/solid',
        '@heroicons/react/24/outline',
        '@visx/visx',
        '@tremor/react',
        'rxjs',
        '@mui/material',
        '@mui/icons-material',
        'recharts',
        'react-use',
        'effect',
        '@effect/schema',
        '@effect/platform',
        '@effect/platform-node',
        '@effect/platform-browser',
        '@effect/platform-bun',
        '@effect/sql',
        '@effect/sql-mssql',
        '@effect/sql-mysql2',
        '@effect/sql-pg',
        '@effect/sql-squlite-node',
        '@effect/sql-squlite-bun',
        '@effect/sql-squlite-wasm',
        '@effect/sql-squlite-react-native',
        '@effect/rpc',
        '@effect/rpc-http',
        '@effect/typeclass',
        '@effect/experimental',
        '@effect/opentelemetry',
        '@material-ui/core',
        '@material-ui/icons',
        '@tabler/icons-react',
        'mui-core',
        'react-icons/ai',
        'react-icons/bi',
        'react-icons/bs',
        'react-icons/cg',
        'react-icons/ci',
        'react-icons/di',
        'react-icons/fa',
        'react-icons/fa6',
        'react-icons/fc',
        'react-icons/fi',
        'react-icons/gi',
        'react-icons/go',
        'react-icons/gr',
        'react-icons/hi',
        'react-icons/hi2',
        'react-icons/im',
        'react-icons/io',
        'react-icons/io5',
        'react-icons/lia',
        'react-icons/lib',
        'react-icons/lu',
        'react-icons/md',
        'react-icons/pi',
        'react-icons/ri',
        'react-icons/rx',
        'react-icons/si',
        'react-icons/sl',
        'react-icons/tb',
        'react-icons/tfi',
        'react-icons/ti',
        'react-icons/vsc',
        'react-icons/wi',
      ],
      trustHostHeader: false,
      isExperimentalCompile: false,
    },
    htmlLimitedBots:
      'Mediapartners-Google|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti',
    bundlePagesRouterDependencies: false,
    configFileName: 'next.config.ts',
    outputFileTracingIncludes: { '/': ['packages/web/server-custom.ts', 'node_modules/open/**/*'] },
    turbopack: {
      resolveAlias: {
        '~/': '/Users/jesse/Documents/GitHub/lace/.worktrees/f-single-file-install/src/',
        '@/': '/Users/jesse/Documents/GitHub/lace/.worktrees/f-single-file-install/packages/web/',
      },
      resolveExtensions: ['.js', '.jsx', '.ts', '.tsx'],
      root: '/Users/jesse/Documents/GitHub/lace/.worktrees/f-single-file-install',
    },
  };

  // Set the Next.js private config environment variable for standalone mode
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
}

// Our enhanced server that replaces the standalone server
async function startLaceServer() {
  // Do our port detection first
  const port = await findAvailablePort(requestedPort, userSpecifiedPort, hostname);
  const url = `http://${hostname}:${port}`;

  console.log(`🚀 Starting Lace server on ${url}...`);

  // Use the same approach as the original Next.js standalone server
  const { startServer } = await import('next/dist/server/lib/start-server');

  try {
    // Start the server with our detected port
    await startServer({
      dir: webDir,
      isDev: isDev,
      hostname: hostname,
      port: port,
      allowRetry: false,
      keepAliveTimeout: undefined,
    });

    console.log(`
✅ Lace is ready!
   
   🌐 URL: ${url}
   🔧 Mode: ${isDev ? 'development' : 'production (standalone)'}
   🔒 Process: Single-process mode (PID: ${process.pid})
   
   Press Ctrl+C to stop
`);

    // Open browser if running interactively - use nft-traced dependencies
    if (shouldOpenBrowser) {
      try {
        console.log(`🔍 DEBUG: Attempting to open browser at ${url}...`);
        // Use regular Node.js module resolution now that dependencies are properly traced
        const { default: open } = await import('open');
        await open(url);
        console.log(`🔍 DEBUG: ✅ Browser opened successfully!`);
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException).code || 'unknown error';
        const errorMessage = (error as Error).message || 'unknown message';
        console.log(`🔍 DEBUG: ❌ Browser opening failed: ${errorMessage} (${errorCode})`);
        console.log(`   ℹ️  Could not open browser automatically (${errorCode})`);
      }
    }
  } catch (error) {
    throw new Error(`Failed to start server on ${url}: ${error}`);
  }
}

// Function to find available port (extracted from the original logic)
async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  const { createServer } = await import('http');

  // Function to test if a port is available (check all interfaces, not just hostname)
  const testPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = createServer();

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          resolve(false);
        } else {
          console.error(`Server error on port ${port} (${err.code || 'unknown'}):`, err.message);
          process.exit(1);
        }
      });

      server.once('listening', () => {
        server.close(() => resolve(true));
      });

      // Test binding to the specific hostname we want to use
      server.listen(port, hostname);
    });
  };

  // If user specified port, only try that one
  if (userSpecified) {
    const available = await testPort(startPort);
    if (!available) {
      console.error(`Error: Port ${startPort} is already in use`);
      process.exit(1);
    }
    return startPort;
  }

  // Try ports starting from the requested port
  for (let port = startPort; port <= startPort + 100; port++) {
    const available = await testPort(port);
    if (available) {
      return port;
    }
  }

  console.error(`Error: Could not find an available port starting from ${startPort}`);
  process.exit(1);
}

startLaceServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});
