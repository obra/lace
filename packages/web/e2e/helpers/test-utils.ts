// ABOUTME: Reusable E2E test utilities for common operations
// ABOUTME: Centralizes UI interactions, per-test server management, and timeout constants

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find an available port by attempting to create a server
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);

    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object' && 'port' in address) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Unable to get port from server address'));
      }
    });
  });
}

/**
 * Wait for server to be ready by attempting HTTP requests
 */
async function waitForServer(url: string, timeoutMs: number = 120000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`${url}/api/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      });

      // Server is ready
      return;
    } catch {
      // Server not ready yet, continue waiting
    }

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

/**
 * Start a test server with isolated LACE_DIR
 */
async function startTestServer(
  tempDir: string
): Promise<{ serverUrl: string; serverProcess: ChildProcess }> {
  // Find available port
  const port = await getAvailablePort();
  const serverUrl = `http://localhost:${port}`;

  // Start server process with isolated environment using E2E test server
  const serverScriptPath = path.resolve(__dirname, '../../e2e-test-server.ts');
  const serverProcess = spawn('npx', ['tsx', serverScriptPath, '--port', port.toString()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LACE_DIR: tempDir,
      ANTHROPIC_API_KEY: 'test-anthropic-key-for-e2e',
      LACE_DB_PATH: path.join(tempDir, 'lace.db'),
      NODE_ENV: 'test', // Use test mode - avoids Vite dev server issues
      E2E_TOOL_APPROVAL_MOCK: 'true',
      LACE_LOG_LEVEL: 'error',
      LACE_LOG_STDERR: 'true',
    },
  });

  // Handle server output for debugging - errors only
  serverProcess.stderr?.on('data', (data: Buffer) => {
    const output = data.toString().trim();
    if (output && !output.includes('Fast Refresh')) {
      console.error(`[E2E-SERVER-${port}] ${output}`);
    }
  });

  serverProcess.on('exit', () => {
    // Server exit handled silently
  });

  // Wait for server to be ready
  await waitForServer(serverUrl);

  return { serverUrl, serverProcess };
}

// Environment setup utilities
export interface TestEnvironment {
  tempDir: string;
  originalLaceDir: string | undefined;
  projectName: string;
  serverUrl: string;
  serverProcess: ChildProcess;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  // Create isolated temp directory for this test
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));
  const originalLaceDir = process.env.LACE_DIR;

  // Create mock credentials for E2E tests
  const credentialsDir = path.join(tempDir, 'credentials');
  await fs.promises.mkdir(credentialsDir, { recursive: true });

  // Create anthropic-default credentials file
  const anthropicCredentials = {
    apiKey: 'test-anthropic-key-for-e2e',
  };
  await fs.promises.writeFile(
    path.join(credentialsDir, 'anthropic-default.json'),
    JSON.stringify(anthropicCredentials, null, 2)
  );

  // Create provider-instances.json configuration
  const providerInstances = {
    version: '1.0',
    instances: {
      'anthropic-default': {
        id: 'anthropic-default',
        displayName: 'Test Anthropic Provider',
        catalogProviderId: 'anthropic',
        isDefault: true,
      },
    },
  };
  await fs.promises.writeFile(
    path.join(tempDir, 'provider-instances.json'),
    JSON.stringify(providerInstances, null, 2)
  );

  // Start isolated test server
  const { serverUrl, serverProcess } = await startTestServer(tempDir);

  const projectName = `E2E Test Project ${Date.now()}`;

  return {
    tempDir,
    originalLaceDir,
    projectName,
    serverUrl,
    serverProcess,
  };
}

export async function cleanupTestEnvironment(env: TestEnvironment) {
  if (!env) {
    return;
  }

  // Kill server process
  if (env.serverProcess && !env.serverProcess.killed) {
    env.serverProcess.kill('SIGTERM');

    // Wait for graceful shutdown, then force kill if needed
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!env.serverProcess.killed) {
          env.serverProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      env.serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // Restore original LACE_DIR (though this is less critical now with per-test servers)
  if (env.originalLaceDir !== undefined) {
    process.env.LACE_DIR = env.originalLaceDir;
  } else {
    delete process.env.LACE_DIR;
  }

  delete process.env.ANTHROPIC_API_KEY;

  // Clean up temp directory
  if (
    env.tempDir &&
    (await fs.promises
      .stat(env.tempDir)
      .then(() => true)
      .catch(() => false))
  ) {
    await fs.promises.rm(env.tempDir, { recursive: true, force: true });
  }
}

/**
 * Standard timeout constants for E2E tests
 * Use these instead of hardcoded values for consistency
 */
export const TIMEOUTS = {
  QUICK: 5000, // Element visibility, form interactions
  STANDARD: 10000, // AI responses, navigation
  EXTENDED: 15000, // Complex operations, streaming
} as const;

/**
 * Simple wrapper that eliminates boilerplate setup/teardown
 * Use this instead of manual beforeEach/afterEach in every test file
 */
export function withTestEnvironment(
  testFn: (testEnv: TestEnvironment, page: Page) => Promise<void>
) {
  return async ({ page }: { page: Page }) => {
    const testEnv = await setupTestEnvironment();
    try {
      await page.goto(testEnv.serverUrl);
      await testFn(testEnv, page);
    } finally {
      await cleanupTestEnvironment(testEnv);
    }
  };
}

// Project management utilities are now in ui-interactions.ts
// This file focuses on test environment setup and management only
