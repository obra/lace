// ABOUTME: Utility for starting isolated test servers with proper temp LACE_DIR setup
// ABOUTME: Each test gets its own server instance with isolated database and filesystem

import { spawn, type ChildProcess } from 'child_process';
// Import the web package temp directory utility
import * as net from 'net';

export interface IsolatedServerContext {
  port: number;
  url: string;
  cleanup: () => Promise<void>;
}

/**
 * Finds an available port for the test server
 */
async function findAvailablePort(startPort: number = 23400): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo)?.port;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error('Failed to get port'));
        }
      });
    });
    server.on('error', () => {
      // Port is busy, try next one
      findAvailablePort(startPort + 1)
        .then(resolve)
        .catch(reject);
    });
  });
}

/**
 * Starts an isolated test server with its own temp LACE_DIR
 * This should be called in beforeEach/beforeAll and cleaned up in afterEach/afterAll
 */
export async function startIsolatedServer(tempDir: string): Promise<IsolatedServerContext> {
  const port = await findAvailablePort();
  const url = `http://localhost:${port}`;

  return new Promise((resolve, reject) => {
    // Start the server with the isolated LACE_DIR
    const serverProcess = spawn('npx', ['tsx', 'server-custom.ts', '--port', port.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Use the provided temp LACE_DIR
        LACE_DIR: tempDir,
        ANTHROPIC_KEY: 'test-anthropic-key-for-e2e-tests',
        ANTHROPIC_API_KEY: 'test-anthropic-key-for-e2e-tests',
        NODE_ENV: 'test',
        VITEST_RUNNING: 'true',
        E2E_TOOL_APPROVAL_MOCK: process.env.E2E_TOOL_APPROVAL_MOCK || 'false',
        NODE_OPTIONS: '--max-old-space-size=2048',
      },
    });

    let serverReady = false;
    const startupTimeout = setTimeout(() => {
      if (!serverReady) {
        serverProcess.kill('SIGTERM');
        reject(new Error(`Server failed to start within timeout on port ${port}`));
      }
    }, 30000); // 30 second timeout

    // Monitor server output to detect when it's ready
    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`[SERVER ${port}] ${output.trim()}`);

      // Look for the URL line indicating server is ready
      if (
        output.includes(`🌐 URL: http://localhost:${port}`) ||
        output.includes('Server is running')
      ) {
        if (!serverReady) {
          serverReady = true;
          clearTimeout(startupTimeout);
          resolve({
            port,
            url,
            cleanup: async () => {
              return new Promise<void>((resolveCleanup) => {
                serverProcess.kill('SIGTERM');
                serverProcess.on('exit', () => {
                  console.log(`[SERVER ${port}] Cleaned up`);
                  resolveCleanup();
                });

                // Force kill after timeout
                setTimeout(() => {
                  if (!serverProcess.killed) {
                    serverProcess.kill('SIGKILL');
                    resolveCleanup();
                  }
                }, 5000);
              });
            },
          });
        }
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      console.error(`[SERVER ${port} ERROR] ${output.trim()}`);
    });

    serverProcess.on('error', (error) => {
      clearTimeout(startupTimeout);
      reject(new Error(`Failed to start server on port ${port}: ${error.message}`));
    });

    serverProcess.on('exit', (code, signal) => {
      if (!serverReady) {
        clearTimeout(startupTimeout);
        reject(new Error(`Server exited unexpectedly with code ${code}, signal ${signal}`));
      }
    });
  });
}

/**
 * Helper that combines withTempLaceDir and startIsolatedServer
 * Use this when you need a completely isolated test environment
 */
export async function withIsolatedServer<T>(
  prefix: string,
  testFn: (serverUrl: string, tempDir: string) => Promise<T>
): Promise<T> {
  const { withTempLaceDir } = await import('./withTempLaceDir');

  return withTempLaceDir(prefix, async (tempDir) => {
    const serverContext = await startIsolatedServer(tempDir);
    try {
      return await testFn(serverContext.url, tempDir);
    } finally {
      await serverContext.cleanup();
    }
  });
}
