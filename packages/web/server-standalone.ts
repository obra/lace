// ABOUTME: Minimal standalone server for Bun executables - no dev dependencies
// ABOUTME: Production-only with embedded asset serving - ships with executable

import { parseArgs } from 'util';
import { createRequestHandler } from '@react-router/express';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';

// Parse CLI args
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
Lace Web Server (Standalone)

Usage: lace [options]

Options:
  -p, --port <port>    Port (default: 31337)
  -h, --host <host>    Host (default: localhost)
  --help               Show help

Fully standalone executable with embedded assets.
`);
  process.exit(0);
}

const port = parseInt(values.port || '31337', 10);
const hostname = values.host || 'localhost';

async function startServer() {
  console.log(`🚀 Starting Lace on http://${hostname}:${port}...`);

  const app = express();
  app.use(compression());
  app.disable('x-powered-by');
  app.use(morgan('tiny'));

  // Import server build directly
  const serverBuild = await import('./build/server/index.js');
  
  // React Router handler
  const requestHandler = createRequestHandler({
    build: () => serverBuild,
    getLoadContext() { return {}; },
  });
  
  app.use(requestHandler);

  app.listen(port, hostname, () => {
    console.log(`✅ Lace ready on http://${hostname}:${port}`);
    console.log(`LACE_SERVER_PORT:${port}`);
    console.log(`LACE_SERVER_URL:http://${hostname}:${port}`);
  });
}

startServer().catch((err) => {
  console.error('❌ Server failed:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));