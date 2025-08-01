// ABOUTME: Custom Next.js server ensuring single-process execution with CLI options
// ABOUTME: Provides --port and --host options for network configuration

import { createServer } from 'http';
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

const requestedPort = parseInt(values.port || '3000', 10);
const hostname = values.host || 'localhost';
const dev = process.env.NODE_ENV !== 'production';
const userSpecifiedPort = !!values.port; // Track if user manually specified port

// Validate port
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  console.error(`Error: Invalid port number: ${values.port}`);
  process.exit(1);
}

// Function to attempt starting the server on a specific port
async function tryStartServer(
  server: ReturnType<typeof createServer>, 
  port: number, 
  hostname: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(true);
    };
    
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        // For other errors, we should fail
        console.error(`Server error on port ${port}:`, err.message);
        process.exit(1);
      }
    };
    
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, hostname);
  });
}

// Function to find an available port and start server
async function startServerOnAvailablePort(
  server: ReturnType<typeof createServer>,
  startPort: number, 
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  // If user specified port, only try that one
  if (userSpecified) {
    const success = await tryStartServer(server, startPort, hostname);
    if (!success) {
      console.error(`Error: Port ${startPort} is already in use`);
      process.exit(1);
    }
    return startPort;
  }

  // Try ports starting from the requested port
  for (let port = startPort; port <= startPort + 100; port++) {
    const success = await tryStartServer(server, port, hostname);
    if (success) {
      return port;
    }
  }

  console.error(`Error: Could not find an available port starting from ${startPort}`);
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
  .then(async () => {
    const server = createServer((req, res) => {
      try {
        handle(req, res);
      } catch (error) {
        console.error('Request handling error:', error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      }
    });

    const port = await startServerOnAvailablePort(server, requestedPort, userSpecifiedPort, hostname);
    
    console.log(`
✅ Lace is ready!
   
   🌐 URL: http://${hostname}:${port}
   🔧 Mode: ${dev ? 'development' : 'production'}
   🔒 Process: Single-process mode (PID: ${process.pid})
   
   Press Ctrl+C to stop
`);
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
