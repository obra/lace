// ABOUTME: Production-only Lace server for standalone executables  
// ABOUTME: No dev dependencies - uses only production React Router build

import { parseArgs } from 'util';
import { createRequestHandler } from '@react-router/express';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';

// Import the production React Router server build
import * as serverBuild from './build/server/index.js';

// Parse command line arguments
const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    host: { type: 'string', short: 'h', default: 'localhost' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Lace Web Server (Production)

Usage: lace [options]

Options:
  -p, --port <port>    Port to listen on (default: 31337, auto-finds available)
  -h, --host <host>    Host to bind to (default: localhost)
  --help               Show this help message

This is a production-only server with no development dependencies.
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

async function startLaceServer() {
  const port = await findAvailablePort(requestedPort, userSpecifiedPort, hostname);
  const safeHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  const url = `http://${safeHost}:${port}`;

  console.log(`🚀 Starting Lace server (production) on ${url}...`);

  const app = express();
  app.use(compression());
  app.disable('x-powered-by');
  app.use(morgan('tiny'));

  // Serve static assets from build directory (development fallback)
  // In standalone executable, this won't be used since files are embedded
  app.use(express.static('build/client', { maxAge: '1h' }));

  // React Router request handler
  const requestHandler = createRequestHandler({
    build: () => serverBuild,
    getLoadContext() {
      return {};
    },
  });

  app.use(requestHandler);

  const server = app.listen(port, hostname, () => {
    console.log(`
✅ Lace is ready!
   
   🌐 URL: ${url}
   🔒 PID: ${process.pid}
   📦 Mode: production standalone
   
   Press Ctrl+C to stop
`);

    console.log(`LACE_SERVER_PORT:${port}`);
    console.log(`LACE_SERVER_URL:${url}`);
  });

  // Graceful shutdown handlers
  const gracefulShutdown = () => {
    console.log('\nReceived shutdown signal, closing server...');
    server.close((err) => {
      if (err) {
        console.error('Error closing server:', err);
        process.exit(1);
      } else {
        console.log('Server closed gracefully');
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

// Port detection function (from server-custom.ts)
async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  const { createServer } = await import('http');

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

  if (userSpecified) {
    const available = await testPort(startPort);
    if (!available) {
      console.error(`Error: Port ${startPort} is already in use`);
      process.exit(1);
    }
    return startPort;
  }

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