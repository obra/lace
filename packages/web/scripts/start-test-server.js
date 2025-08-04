// ABOUTME: Test server wrapper that starts Lace server and reports back the actual URL
// ABOUTME: Handles port detection communication between server and Playwright

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const TEST_PORT_START = 23457;
const PORT_FILE = join(process.cwd(), '.playwright-server-url');

function startServer() {
  // Use E2E test server for tool approval tests, regular server otherwise
  const serverFile = process.env.E2E_TOOL_APPROVAL_MOCK === 'true' ? 'e2e-test-server.ts' : 'server.ts';
  
  // Start the server with our test port
  const serverProcess = spawn('npx', ['tsx', serverFile, '--port', TEST_PORT_START.toString()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Pass through the test environment variables
      ANTHROPIC_KEY: 'test-anthropic-key-for-e2e-tests',
      ANTHROPIC_API_KEY: 'test-anthropic-key-for-e2e-tests',
      LACE_DB_PATH: ':memory:',
      NODE_ENV: 'test',
      VITEST_RUNNING: 'true',
      // Enable tool approval mock provider for E2E tests
      E2E_TOOL_APPROVAL_MOCK: process.env.E2E_TOOL_APPROVAL_MOCK || 'false',
    }
  });

  let serverUrl = null;

  // Parse stdout to find the actual URL
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output); // Forward output for logging
    
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

  // Forward stderr
  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  // Handle server exit
  serverProcess.on('exit', (code, signal) => {
    console.log(`🏁 Server process exited with code ${code}, signal ${signal}`);
    process.exit(code || 0);
  });

  // Handle wrapper script termination
  process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, terminating server...');
    serverProcess.kill('SIGTERM');
  });

  process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, terminating server...');
    serverProcess.kill('SIGINT');
  });

  // Ensure we don't exit before server is ready
  process.on('exit', () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  });
}

console.log('🚀 Starting test server wrapper...');
startServer();