// ABOUTME: Test server wrapper that starts Lace server and reports back the actual URL
// ABOUTME: Handles port detection communication between server and Playwright

import { spawn, type ChildProcess } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_PORT_START = 23457;
const PORT_FILE = join(process.cwd(), '.playwright-server-url');

async function startServer(): Promise<void> {
  // Use E2E test server for tool approval tests, regular server otherwise
  const serverFile =
    process.env.E2E_TOOL_APPROVAL_MOCK === 'true' ? 'e2e-test-server.ts' : 'server-custom.ts';

  // Create a temp directory for the test server's LACE_DIR using same pattern as src/test-utils/temp-lace-dir.ts
  // This allows each test suite run to have isolated data
  const testLaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));
  console.log(`📁 Created test LACE_DIR: ${testLaceDir}`);

  // Start the server with our test port
  const serverProcess = spawn('npx', ['tsx', serverFile, '--port', TEST_PORT_START.toString()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Pass through the test environment variables
      ANTHROPIC_KEY: 'test-anthropic-key-for-e2e-tests',
      ANTHROPIC_API_KEY: 'test-anthropic-key-for-e2e-tests',
      LACE_DIR: testLaceDir, // Use temp directory instead of :memory:
      NODE_ENV: 'test',
      VITEST_RUNNING: 'true',
      // Enable tool approval mock provider for E2E tests
      E2E_TOOL_APPROVAL_MOCK: process.env.E2E_TOOL_APPROVAL_MOCK || 'false',
      // Fix memory leak by increasing max listeners
      NODE_OPTIONS: '--max-old-space-size=2048',
    },
  });

  // Increase max listeners to prevent memory leaks
  serverProcess.stdout.setMaxListeners(20);
  serverProcess.stderr.setMaxListeners(20);
  serverProcess.setMaxListeners(20);

  let serverUrl = null;

  // Parse stdout to find the actual URL
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    try {
      process.stdout.write(output); // Forward output for logging
    } catch (error) {
      // Ignore EPIPE errors when forwarding output
      if (error.code !== 'EPIPE') {
        console.error('Error forwarding stdout:', error);
      }
    }

    // Look for the URL line: "🌐 URL: http://localhost:PORT"
    const urlMatch = output.match(/🌐 URL: (http:\/\/[^:\s]+:\d+)/);
    if (urlMatch) {
      serverUrl = urlMatch[1];
      console.log(`📝 Detected server URL: ${serverUrl}`);

      // Write URL to file for Playwright to read
      writeFileSync(PORT_FILE, serverUrl, 'utf8');
      console.log(`✅ Server URL written to ${PORT_FILE}`);
    }
  });

  // Forward stderr with error handling
  serverProcess.stderr.on('data', (data) => {
    try {
      process.stderr.write(data);
    } catch (error) {
      // Ignore EPIPE errors when forwarding error output
      if (error.code !== 'EPIPE') {
        console.error('Error forwarding stderr:', error);
      }
    }
  });

  // Handle server exit
  serverProcess.on('exit', (code, signal) => {
    console.log(`🏁 Server process exited with code ${code}, signal ${signal}`);

    // Clean up test LACE_DIR
    try {
      rmSync(testLaceDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test LACE_DIR: ${testLaceDir}`);
    } catch (error) {
      console.warn(`⚠️ Failed to clean up test LACE_DIR: ${error.message}`);
    }

    process.exit(code || 0);
  });

  // Handle wrapper script termination
  process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, terminating server...');
    serverProcess.kill('SIGTERM');

    // Clean up temp directory on signal
    try {
      rmSync(testLaceDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test LACE_DIR on SIGTERM: ${testLaceDir}`);
    } catch (error) {
      console.warn(`⚠️ Failed to clean up test LACE_DIR on SIGTERM: ${error.message}`);
    }
  });

  process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, terminating server...');
    serverProcess.kill('SIGINT');

    // Clean up temp directory on signal
    try {
      rmSync(testLaceDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test LACE_DIR on SIGINT: ${testLaceDir}`);
    } catch (error) {
      console.warn(`⚠️ Failed to clean up test LACE_DIR on SIGINT: ${error.message}`);
    }
  });

  // Ensure we don't exit before server is ready
  process.on('exit', () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }

    // Final cleanup attempt
    try {
      rmSync(testLaceDir, { recursive: true, force: true });
    } catch (error) {
      // Silent cleanup on exit
    }
  });
}

console.log('🚀 Starting test server wrapper...');
void startServer();
