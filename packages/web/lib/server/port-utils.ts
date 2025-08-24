// ABOUTME: Port detection and management utilities for server startup
// ABOUTME: Handles finding available ports and port validation

import { createServer } from 'http';

/**
 * Finds an available port starting from the requested port
 */
export async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  // Function to test if a port is available (check all interfaces, not just hostname)
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

      // Test binding to the specific hostname we want to use
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

/**
 * Validates that a port number is valid
 */
export function validatePort(
  portString: string | undefined,
  defaultPort: number
): {
  port: number;
  userSpecified: boolean;
} {
  const userSpecified = !!portString;
  const port = parseInt(portString || defaultPort.toString(), 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port number: "${portString}" (parsed as ${port})`);
    process.exit(1);
  }

  return { port, userSpecified };
}
