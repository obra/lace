// ABOUTME: Test server utilities for Playwright E2E tests
// ABOUTME: Provides server-per-test functionality with unique ports

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

export interface TestServer {
  port: number;
  baseURL: string;
  cleanup: () => Promise<void>;
}

/**
 * Find an available port by letting the OS choose
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not get port')));
      }
    });

    server.on('error', (err) => {
      server.close(() => reject(err));
    });
  });
}

/**
 * Start a Next.js server for testing on a unique port
 * Each test file should get its own server instance
 */
export async function startTestServer(): Promise<TestServer> {
  // Get a random available port
  const port = await getAvailablePort();

  // Create Next.js app in development mode for easier debugging
  const app = next({
    dev: true, // Use dev mode for easier debugging
    dir: process.cwd(),
    quiet: true, // Reduce noise in test output
    turbo: false, // Disable turbo mode for more stable testing
  });

  const handle = app.getRequestHandler();

  // Prepare the Next.js app with timeout
  await Promise.race([
    app.prepare(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Next.js app preparation timeout')), 30000)
    ),
  ]);

  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Start listening on the port with timeout
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      server.listen(port, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Server start timeout')), 10000)),
  ]);

  const baseURL = `http://localhost:${port}`;

  // Return server info and cleanup function
  return {
    port,
    baseURL,
    cleanup: async () => {
      try {
        // Force close any remaining connections first (Node.js 18.2+)
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }

        // Close the HTTP server with timeout
        await Promise.race([
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Server close timeout')), 5000)
          ),
        ]);

        // Close the Next.js app with timeout
        if (app.close) {
          await Promise.race([
            app.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Next.js app close timeout')), 5000)
            ),
          ]);
        }
      } catch (error) {
        console.warn('Warning: Error during server cleanup:', error);
        // Continue cleanup even if there are errors
      }
    },
  };
}

/**
 * Create a fetch function that makes requests to the test server
 */
export function createTestFetch(baseURL: string) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const fullURL = url.startsWith('/') ? `${baseURL}${url}` : url;
    return fetch(fullURL, init);
  };
}
