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
    dev: true, // Use dev mode for faster startup and better debugging
    dir: process.cwd(),
    quiet: true, // Reduce noise in test output
  });

  const handle = app.getRequestHandler();

  // Prepare the Next.js app
  await app.prepare();

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

  // Start listening on the port
  await new Promise<void>((resolve, reject) => {
    server.listen(port, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const baseURL = `http://localhost:${port}`;

  // Return server info and cleanup function
  return {
    port,
    baseURL,
    cleanup: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      // Note: app.close() might not be available in all Next.js versions
      try {
        await app.close?.();
      } catch {
        // Ignore cleanup errors
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
