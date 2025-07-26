// ABOUTME: Custom Next.js server ensuring single-process execution with CLI options
// ABOUTME: Provides --port and --host options for network configuration

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { parseArgs } from 'util';

// Parse command line arguments
const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      short: 'p',
      default: '3000',
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
  -p, --port <port>    Port to listen on (default: 3000)
  -h, --host <host>    Host to bind to (default: localhost)
                       Use '0.0.0.0' to allow external connections
  --help               Show this help message

Examples:
  npm start                        # Start on localhost:3000
  npm start -- --port 8080         # Start on localhost:8080
  npm start -- --host 0.0.0.0      # Allow external connections
  npm run dev -- --port 3001       # Development mode on port 3001
`);
  process.exit(0);
}

const port = parseInt(values.port || '3000', 10);
const hostname = values.host || 'localhost';
const dev = process.env.NODE_ENV !== 'production';

// Validate port
if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`Error: Invalid port number: ${values.port}`);
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

const app = next({ dev });
const handle = app.getRequestHandler();

console.log(`Starting Lace in ${dev ? 'development' : 'production'} mode...`);

app
  .prepare()
  .then(() => {
    createServer((req, res) => {
      const parsedUrl = parse(req.url!, true);
      handle(req, res, parsedUrl);
    }).listen(port, hostname, () => {
      console.log(`
✅ Lace is ready!
   
   🌐 URL: http://${hostname}:${port}
   🔧 Mode: ${dev ? 'development' : 'production'}
   🔒 Process: Single-process mode (PID: ${process.pid})
   
   Press Ctrl+C to stop
`);
    });
  })
  .catch((err) => {
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
