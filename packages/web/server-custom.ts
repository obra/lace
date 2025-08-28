// ABOUTME: Custom React Router v7 server with enhanced CLI options and port detection
// ABOUTME: Provides single-process server with Lace-specific startup logic and port selection

import './lib/server/data-dir-init';
import { parseArgs } from 'util';
import path from 'node:path';
import { createRequestHandler } from '@react-router/express';
import type { ServerBuild } from 'react-router';

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
  // eslint-disable-next-line no-console -- Help text output is appropriate for CLI server
  console.log(`
Lace Web Server (React Router v7)

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

const userSpecifiedPort = !!values.port;
const requestedPort = parseInt(values.port || '31337', 10);
const hostname = values.host || 'localhost';

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

// Detect mode - default to development unless explicitly set to production
const DEVELOPMENT = process.env.NODE_ENV !== 'production';

// Enhanced server that wraps React Router v7
async function startLaceServer() {
  // Do our port detection first
  const port = await findAvailablePort(requestedPort, userSpecifiedPort, hostname);
  const url = `http://${hostname}:${port}`;

  // eslint-disable-next-line no-console -- Server startup message is appropriate for server process
  console.log(`🚀 Starting Lace server (React Router v7) on ${url}...`);

  // Create Express app with static file serving and React Router
  const express = await import('express');
  const compression = await import('compression');

  const app = express.default();

  // Express middleware
  app.use(compression.default());
  app.disable('x-powered-by');

  if (DEVELOPMENT) {
    console.error('Starting development server with Vite middleware');

    // Development mode - use Vite middleware
    const viteDevServer = await import('vite').then((vite) =>
      vite.createServer({
        server: { middlewareMode: true },
      })
    );

    app.use(viteDevServer.middlewares);

    // Handle all routes using React Router template pattern
    app.use(async (req, res, next) => {
      try {
        const source = await viteDevServer.ssrLoadModule('./server/app.ts');
        return await (
          source as { app: (req: unknown, res: unknown, next: unknown) => Promise<unknown> }
        ).app(req, res, next);
      } catch (error) {
        if (typeof error === 'object' && error instanceof Error) {
          viteDevServer.ssrFixStacktrace(error);
        }
        next(error);
      }
    });
  } else {
    console.error('Starting production server with static file serving');
    const morgan = await import('morgan');

    // Production mode - static assets FIRST, exactly like React Router template
    const clientRoot = path.resolve(process.cwd(), 'build', 'client');
    const assetsRoot = path.join(clientRoot, 'assets');
    app.use('/assets', express.static(assetsRoot, { immutable: true, maxAge: '1y' }));
    app.use(morgan.default('tiny'));
    app.use(express.static(clientRoot, { maxAge: '1h' }));

    // Import and mount React Router app last
    const requestHandler = createRequestHandler({
      build: () =>
        // @ts-expect-error - Build file will exist in production
        import('./build/server/index.js') as Promise<ServerBuild>,
      getLoadContext() {
        return {
          // Add any context needed by your routes here
        };
      },
    });
    app.use(requestHandler);
  }

  app.listen(port, hostname, () => {
    // eslint-disable-next-line no-console -- Server ready message with URL/PID is appropriate for server process
    console.log(`
✅ Lace is ready!
   
   🌐 URL: ${url}
   🔒 PID: ${process.pid}
   📦 Mode: ${DEVELOPMENT ? 'development' : 'production'}
   
   Press Ctrl+C to stop
`);

    // Signal the actual port to parent process (for menu bar app)
    // eslint-disable-next-line no-console -- Port/URL signaling required for parent process communication
    console.log(`LACE_SERVER_PORT:${port}`);
    // eslint-disable-next-line no-console -- Port/URL signaling required for parent process communication
    console.log(`LACE_SERVER_URL:${url}`);
  });
}

// Function to find available port (preserved from original)
async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  const { createServer } = await import('http');

  // Function to test if a port is available
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

// Graceful shutdown (preserved from original)
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
