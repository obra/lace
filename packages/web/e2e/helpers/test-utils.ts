// ABOUTME: Reusable E2E test utilities for common operations
// ABOUTME: Centralizes UI interactions and per-test server management

import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

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
async function waitForServer(url: string, timeoutMs: number = 60000): Promise<void> {
  const startTime = Date.now();
  let lastError: string = 'unknown';
  let hasSeenNextJS = false;

  console.log(`⏳ Waiting for server at ${url}/api/health...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // Be patient with slow compilation
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data) {
          console.log(`✅ Server ready at ${url} - health response:`, data);
          return;
        } else {
          lastError = 'Valid response but no JSON data';
        }
      } else if (response.status === 500) {
        // 500 errors might be compilation issues - be more patient
        lastError = `HTTP ${response.status} (compilation may be in progress)`;
        console.log(`⚠️ ${url}/api/health returned 500 - likely still compiling...`);
      } else {
        lastError = `HTTP ${response.status} ${response.statusText}`;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        lastError = 'Request timeout (server may be compiling)';
      } else {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // Check if we can at least connect to the root
      try {
        const rootResponse = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        if (rootResponse.status !== 404) {
          hasSeenNextJS = true;
        }
      } catch {
        // Ignore root check failures
      }

      // Console log every few attempts to track progress
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 5 === 0 && (Date.now() - startTime) % 5000 < 500) {
        console.log(
          `🔄 Still waiting for ${url}/api/health (${elapsed}s) - ${lastError}${hasSeenNextJS ? ' (Next.js responding)' : ''}`
        );
      }
    }

    // Wait before retrying - longer interval for compilation
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Server at ${url} failed to start within ${timeoutMs}ms. Last error: ${lastError}`
  );
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

  console.log(`🚀 Starting test server with LACE_DIR=${tempDir} on port ${port}`);

  // Start server process with isolated environment
  const serverProcess = spawn('npx', ['tsx', 'server-custom.ts', '--port', port.toString()], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LACE_DIR: tempDir,
      ANTHROPIC_KEY: 'test-anthropic-key-for-e2e',
      LACE_DB_PATH: path.join(tempDir, 'lace.db'),
      NODE_ENV: 'test',
    },
  });

  // Handle server output
  serverProcess.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`[SERVER:${port}] ${output}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.error(`[SERVER:${port}] ${output}`);
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`Server process ${port} exited with code ${code}`);
    }
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
    console.log('⚠️  No test environment to cleanup');
    return;
  }

  console.log(`🧹 Cleaning up test environment: ${env.tempDir}`);

  // Kill server process
  if (env.serverProcess && !env.serverProcess.killed) {
    console.log(`🛑 Stopping server process`);
    env.serverProcess.kill('SIGTERM');

    // Wait for graceful shutdown, then force kill if needed
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!env.serverProcess.killed) {
          console.log(`🔨 Force killing server process`);
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

  delete process.env.ANTHROPIC_KEY;

  // Clean up temp directory
  if (
    env.tempDir &&
    (await fs.promises
      .stat(env.tempDir)
      .then(() => true)
      .catch(() => false))
  ) {
    await fs.promises.rm(env.tempDir, { recursive: true, force: true });
    console.log(`✅ Cleaned up temp directory: ${env.tempDir}`);
  }
}

// Project management utilities are now in ui-interactions.ts
// This file focuses on test environment setup and management only
