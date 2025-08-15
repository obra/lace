// ABOUTME: Utility for managing isolated LACE_DIR environments in E2E tests  
// ABOUTME: Provides temp directory setup, cleanup, environment variable management, and test server startup

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'http';
import next from 'next';
import { initializeAuthWithPassword, getOrGenerateJWTSecret } from '@/lib/server/auth-config';

interface TestServerInstance {
  url: string;
  port: number;
  server: ReturnType<typeof createServer>;
  close: () => Promise<void>;
}

let globalTestServer: TestServerInstance | null = null;

/**
 * Starts a Next.js test server on the expected port for Playwright tests
 */
async function startTestServer(): Promise<TestServerInstance> {
  const dev = process.env.NODE_ENV !== 'production';
  // Use worker index to avoid port conflicts between parallel workers
  const workerIndex = parseInt(process.env.TEST_WORKER_INDEX || '0', 10);
  const port = 23457 + workerIndex; // Different port per worker
  const hostname = 'localhost';
  
  // Set JWT secret environment variable for middleware
  process.env.LACE_JWT_SECRET = getOrGenerateJWTSecret();
  
  const app = next({ dev });
  const handle = app.getRequestHandler();
  
  console.log('🎭 Starting test server for E2E tests...');
  
  await app.prepare();
  
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
  
  return new Promise<TestServerInstance>((resolve, reject) => {
    const onListening = () => {
      server.removeListener('error', onError);
      const url = `http://${hostname}:${port}`;
      console.log(`🎭 Test server ready at ${url}`);
      
      const close = () => new Promise<void>((closeResolve) => {
        server.close(() => {
          console.log('🎭 Test server closed');
          closeResolve();
        });
      });
      
      resolve({ url, port, server, close });
    };

    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      console.error(`Failed to start test server on port ${port}:`, err.message);
      reject(err);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, hostname);
  });
}

/**
 * Shuts down the global test server if it exists
 */
export async function shutdownTestServer(): Promise<void> {
  if (globalTestServer) {
    await globalTestServer.close();
    globalTestServer = null;
  }
}

/**
 * Creates an isolated LACE_DIR environment for a test with server startup
 * @param prefix - Prefix for the temporary directory name  
 * @param testFn - Test function to execute with the isolated environment
 * @returns Promise that resolves when test completes and cleanup is done
 */
export async function withTempLaceDir<T>(
  prefix: string,
  testFn: (tempDir: string) => Promise<T>
): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), prefix)
  );
  const originalLaceDir = process.env.LACE_DIR;
  
  // Set isolated LACE_DIR
  process.env.LACE_DIR = tempDir;
  
  // Auto-initialize authentication for E2E tests (preserves existing test compatibility)
  const testPassword = generateTestPassword();
  await initializeAuthWithPassword(testPassword);
  
  // Store test password for potential use by tests
  (global as any).__E2E_TEST_PASSWORD = testPassword;
  
  // Start test server if not already running
  if (!globalTestServer) {
    globalTestServer = await startTestServer();
  }
  
  try {
    return await testFn(tempDir);
  } finally {
    // Always restore original environment
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    
    // Clean up temp directory
    try {
      await fs.promises.stat(tempDir);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Directory already removed or doesn't exist - ignore
    }
    
    // Clean up global test password
    delete (global as any).__E2E_TEST_PASSWORD;
  }
}

/**
 * Generate a test-specific password for E2E testing
 */
function generateTestPassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const length = 16;
  const bytes = crypto.randomBytes(length);
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  
  return result;
}

/**
 * Get the current test password for authentication in E2E tests
 */
export function getTestPassword(): string {
  const password = (global as any).__E2E_TEST_PASSWORD;
  if (!password) {
    throw new Error('No test password available. Make sure you are running within withTempLaceDir()');
  }
  return password;
}

/**
 * Helper to authenticate in an E2E test using the auto-generated password
 */
export async function authenticateInTest(page: any): Promise<void> {
  const password = getTestPassword();
  
  // Navigate to login page and authenticate
  await page.goto('/login');
  await page.locator('[data-testid="password-input"]').fill(password);
  await page.locator('[data-testid="login-button"]').click();
  
  // Wait for redirect to main app
  await page.waitForURL('/', { timeout: 10000 });
}