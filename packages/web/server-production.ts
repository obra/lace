// ABOUTME: Production-only Lace server for standalone executables
// ABOUTME: No dev dependencies - uses only production React Router build

/* eslint-disable no-console -- Server startup and logging is appropriate for server process */

import './lib/server/data-dir-init';
import { parseArgs } from 'util';
import { createRequestHandler } from '@react-router/express';
import type { ServerBuild } from 'react-router';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';

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

  // Show embedded files at startup for debugging
  if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles) {
    console.log(`\n📦 Embedded files: ${Bun.embeddedFiles.length} total`);

    const catalogs = Array.from(Bun.embeddedFiles).filter(
      (f) =>
        (f as File).name.includes('providers/catalog/data') && (f as File).name.endsWith('.json')
    );
    console.log(`📋 Provider catalogs: ${catalogs.length}`);

    const prompts = Array.from(Bun.embeddedFiles).filter(
      (f) => (f as File).name.includes('config/prompts') && (f as File).name.endsWith('.md')
    );
    console.log(`📄 Prompt templates: ${prompts.length}`);

    const assets = Array.from(Bun.embeddedFiles).filter((f) =>
      (f as File).name.includes('/build/client/')
    );
    console.log(`🎨 Client assets: ${assets.length}`);
    console.log('');
  } else {
    console.log('\n❌ No Bun.embeddedFiles available\n');
  }

  const app = express();
  app.use(compression());
  app.disable('x-powered-by');
  app.use(morgan('tiny'));

  // Create static middleware once
  const staticMiddleware = express.static('build/client', { maxAge: '1h' });

  // Serve assets from embedded files or fallback to file system
  app.use((req, res, next) => {
    // Try embedded files first (Bun executable)
    if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles) {
      // Look for client assets by matching the request path to embedded file paths
      const assetFile = Array.from(Bun.embeddedFiles).find((f) => {
        if (!(f as File).name.includes('/build/client')) return false;

        // Extract the path after /build/client from the embedded (file as File).name
        const clientPath = (f as File).name.split('/build/client')[1];
        return clientPath === req.path;
      });

      if (assetFile) {
        assetFile
          .text()
          .then((content) => {
            const contentType = getContentType(req.path);
            res.setHeader('content-type', contentType);
            res.setHeader('cache-control', 'public, max-age=31536000');
            res.send(content);
          })
          .catch((err) => {
            console.error('Failed to read embedded asset:', req.path, err);
            next();
          });
        return;
      }
    }

    // Fallback to file system (development)
    staticMiddleware(req, res, next);
  });

  function getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      js: 'application/javascript',
      css: 'text/css',
      html: 'text/html',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      svg: 'image/svg+xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
    };
    return types[ext || ''] || 'application/octet-stream';
  }

  // React Router request handler
  const requestHandler = createRequestHandler({
    build: () =>
      // @ts-expect-error - Build file will exist in production
      import('./build/server/index.js') as Promise<ServerBuild>,

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

  const testPort = async (port: number): Promise<boolean> => {
    // Test both IPv4 and IPv6 to ensure port is completely free
    const testInterface = (testHostname: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = createServer();

        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
            resolve(false);
          } else {
            console.error(`Server error on port ${port} (${err.code || 'unknown'}):`, err.message);
            resolve(false);
          }
        });

        server.once('listening', () => {
          server.close(() => resolve(true));
        });

        server.listen(port, testHostname);
      });
    };

    // Test IPv4
    const ipv4Available = await testInterface('127.0.0.1');
    if (!ipv4Available) {
      return false;
    }

    // Test IPv6 (if hostname is localhost)
    if (hostname === 'localhost') {
      const ipv6Available = await testInterface('::1');
      if (!ipv6Available) {
        return false;
      }
    }

    return true;
  };

  if (userSpecified) {
    console.log(`Checking if port ${startPort} is available...`);
    const available = await testPort(startPort);
    if (!available) {
      console.error(`❌ Error: Port ${startPort} is already in use`);
      process.exit(1);
    }
    console.log(`✅ Port ${startPort} is available`);
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
