// ABOUTME: Direct React Router v7 server without ZIP extraction complexity  
// ABOUTME: Uses Bun's bundler to include all dependencies directly

import { parseArgs } from 'util';

interface ServerOptions {
  port?: number;
  host?: string;
  verbose?: boolean;
}

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
Lace - React Router v7 Single-File Executable

Usage: ./lace [options]

Options:
  --port, -p <port>    Server port (default: 31337 or next available)  
  --host, -h <host>    Server host (default: localhost)
  --help               Show this help message

Examples:
  ./lace                    # Start on localhost:31337
  ./lace --port 8080        # Start on port 8080
  ./lace --host 0.0.0.0     # Listen on all interfaces
`);
  process.exit(0);
}

async function startLaceServer() {
  const userSpecifiedPort = !!values.port;
  const requestedPort = parseInt(values.port || '31337', 10);
  const hostname = values.host || 'localhost';

  // Find available port  
  const port = await findAvailablePort(requestedPort, userSpecifiedPort, hostname);
  const url = `http://${hostname}:${port}`;

  console.log(`🚀 Starting Lace (React Router v7) on ${url}...`);

  // Start React Router v7 server directly
  const { createRequestHandler } = await import('@react-router/express');
  const express = await import('express');
  
  // Import the built server
  const build = await import('../packages/web/build/server/index.js');
  
  const app = express.default();
  const requestHandler = createRequestHandler({
    build: build.default || build,
  });

  // Serve static files from build/client
  app.use(express.static('../packages/web/build/client'));
  
  // Handle all requests through React Router
  app.use(requestHandler);

  await new Promise<void>((resolve, reject) => {
    app.listen(port, hostname, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log(`
✅ Lace is ready!
   
   🌐 URL: ${url}
   🔒 PID: ${process.pid}
   
   Press Ctrl+C to stop
`);
}

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
          console.error(`Server error on port ${port}:`, err.message);
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

  console.error(`Error: Could not find available port starting from ${startPort}`);
  process.exit(1);
}

startLaceServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});