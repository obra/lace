// ABOUTME: React Router v7 server with embedded VFS build files
// ABOUTME: No file extraction needed - serves directly from memory

import { parseArgs } from 'util';
import clientVfs from './react-router-client-vfs';

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
Lace - React Router v7 Single-File Executable (VFS)

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

  console.log(`🚀 Starting Lace (React Router v7 + VFS) on ${url}...`);

  // Create simple HTTP server that serves from VFS
  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const urlPath = new URL(req.url).pathname;
      
      // Handle root - serve index.html if it exists, or delegate to React Router
      if (urlPath === '/') {
        // Serve main HTML or fall back to React Router
        return serveFromVFS('index.html') || new Response('React Router App', {
          headers: { 'content-type': 'text/html' }
        });
      }
      
      // Try to serve static file from VFS first
      const vfsResponse = serveFromVFS(urlPath.slice(1)); // Remove leading /
      if (vfsResponse) {
        return vfsResponse;
      }
      
      // For non-static files, serve the React Router app (SPA mode)
      return new Response('React Router SPA - All routes handled client-side', {
        headers: { 'content-type': 'text/html' }
      });
    },
  });

  console.log(`
✅ Lace is ready!
   
   🌐 URL: ${url}
   🔒 PID: ${process.pid}
   📁 VFS Files: ${Object.keys(clientVfs).length}
   
   Press Ctrl+C to stop
`);
}

function serveFromVFS(filePath: string): Response | null {
  const fileContent = clientVfs[filePath];
  if (!fileContent) {
    return null;
  }

  // Determine content type based on file extension
  const contentType = getContentType(filePath);
  
  return new Response(fileContent, {
    headers: { 
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000' // 1 year cache for static assets
    }
  });
}

function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  const contentTypes: Record<string, string> = {
    'html': 'text/html',
    'js': 'application/javascript',
    'css': 'text/css',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
  };
  
  return contentTypes[ext || ''] || 'application/octet-stream';
}

async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  const testPort = async (port: number): Promise<boolean> => {
    try {
      const testServer = Bun.serve({
        port,
        hostname,
        fetch: () => new Response('test')
      });
      testServer.stop();
      return true;
    } catch {
      return false;
    }
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