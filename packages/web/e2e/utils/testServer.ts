// ABOUTME: Utilities for starting/stopping isolated test server instances per test file
// ABOUTME: Provides complete isolation including LACE_DIR, database, and auth state

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createServer } from 'http';
import { initializeAuthWithPassword } from '@/lib/server/auth-config';

let testServerProcess: ChildProcess | null = null;
let testServerUrl: string | null = null;
let tempLaceDir: string | null = null;

/**
 * Start an isolated test server with its own LACE_DIR and auth state
 * @param testName - Name prefix for the temp directory
 * @returns Promise<{ url: string; tempDir: string; password: string }>
 */
export async function startTestServer(testName: string): Promise<{ 
  url: string; 
  tempDir: string; 
  password: string;
}> {
  // Create isolated temp directory for this test file
  tempLaceDir = await fs.mkdtemp(path.join(os.tmpdir(), `lace-e2e-${testName}-`));
  
  // Generate auth password for this test server
  const password = generateTestPassword();
  
  // Initialize auth config in the temp directory
  await initializeAuthInTempDir(tempLaceDir, password);
  
  // Find available port starting from 23457
  const port = await findAvailablePort(23457);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Test server startup timeout'));
    }, 60000);

    // Start server with isolated environment
    testServerProcess = spawn('npx', ['tsx', 'server-custom.ts', '--port', port.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Isolated environment
        LACE_DIR: tempLaceDir!,
        LACE_DB_PATH: ':memory:',
        NODE_ENV: 'test',
        VITEST_RUNNING: 'true',
        // API keys for testing
        ANTHROPIC_KEY: 'test-anthropic-key-for-e2e-tests',
        ANTHROPIC_API_KEY: 'test-anthropic-key-for-e2e-tests',
        // Tool approval mock
        E2E_TOOL_APPROVAL_MOCK: 'false',
      },
    });

    // Parse server output to get URL
    testServerProcess!.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('[TEST-SERVER]', output); // Debug server output
      
      // Look for the URL line: "🌐 URL: http://localhost:PORT"
      const urlMatch = output.match(/🌐 URL: (http:\/\/[^:\s]+:\d+)/);
      if (urlMatch) {
        testServerUrl = urlMatch[1];
        console.log('🧪 Test server ready at:', testServerUrl);
        clearTimeout(timeout);
        resolve({ 
          url: testServerUrl!, 
          tempDir: tempLaceDir!, 
          password 
        });
      }
    });

    // Forward stderr for debugging
    testServerProcess!.stderr?.on('data', (data) => {
      console.error('[TEST-SERVER]', data.toString());
    });

    testServerProcess!.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    testServerProcess!.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Test server exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop the test server and clean up resources
 */
export async function stopTestServer(): Promise<void> {
  if (testServerProcess) {
    testServerProcess.kill('SIGTERM');
    testServerProcess = null;
  }
  
  testServerUrl = null;
  
  // Clean up temp directory
  if (tempLaceDir) {
    try {
      await fs.rm(tempLaceDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
    tempLaceDir = null;
  }
}

/**
 * Initialize auth config in the temp directory for E2E testing
 */
async function initializeAuthInTempDir(laceDir: string, password: string): Promise<void> {
  // Temporarily set LACE_DIR so the auth config functions use the test directory
  const originalLaceDir = process.env.LACE_DIR;
  process.env.LACE_DIR = laceDir;
  
  console.log(`[AUTH-INIT] Setting up auth in ${laceDir} with password: ${password.substring(0, 4)}...`);
  
  try {
    await initializeAuthWithPassword(password);
    console.log(`[AUTH-INIT] Auth initialization completed for ${laceDir}`);
    
    // Verify the auth config was created
    const authConfigPath = path.join(laceDir, 'auth.json');
    const exists = await fs.access(authConfigPath).then(() => true).catch(() => false);
    console.log(`[AUTH-INIT] Auth config exists at ${authConfigPath}: ${exists}`);
  } catch (error) {
    console.error(`[AUTH-INIT] Failed to initialize auth in ${laceDir}:`, error);
    throw error;
  } finally {
    // Restore original LACE_DIR
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
  }
}

/**
 * Generate a test-specific password
 */
function generateTestPassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const length = 24;
  const bytes = crypto.randomBytes(length);
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  
  return result;
}

/**
 * Find an available port starting from the given port number
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  
  throw new Error(`No available ports found starting from ${startPort}`);
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    
    server.on('error', () => resolve(false));
  });
}