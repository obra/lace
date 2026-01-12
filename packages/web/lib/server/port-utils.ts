// ABOUTME: Shared utilities for server port detection and validation
// ABOUTME: Used by both development and production server startup scripts

/* eslint-disable no-console -- Server startup logging is appropriate for this module */

/**
 * Finds an available port starting from the given port.
 * If userSpecified is true, only checks the exact port and exits on failure.
 * If userSpecified is false, searches up to 100 ports from the start.
 *
 * For localhost, tests both IPv4 (127.0.0.1) and IPv6 (::1) to ensure
 * the port is completely free on all interfaces.
 *
 * @param startPort - The port to start searching from
 * @param userSpecified - Whether the user explicitly requested this port
 * @param hostname - The hostname to bind to
 * @returns The first available port found
 */
export async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  const { createServer } = await import('http');

  const testPort = async (port: number): Promise<boolean> => {
    // Test a specific interface
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

    // Test IPv4 first
    const ipv4Available = await testInterface('127.0.0.1');
    if (!ipv4Available) {
      return false;
    }

    // For localhost, also test IPv6 to ensure port is free on both
    if (hostname === 'localhost') {
      const ipv6Available = await testInterface('::1');
      if (!ipv6Available) {
        return false;
      }
    }

    return true;
  };

  // If user specified an exact port, only try that one
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
