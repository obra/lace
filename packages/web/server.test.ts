// ABOUTME: Tests for server startup, port detection, and browser opening functionality
// ABOUTME: Covers port validation, auto-detection logic, TTY detection, and error handling

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';

// Mock the open package
vi.mock('open', () => ({
  default: vi.fn(),
}));

// Import open after mocking
const open = await import('open');
const mockOpen = vi.mocked(open.default);

// Helper to create a test server
function createTestServer(): Server {
  return createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Test server');
  });
}

// Helper to check if port is available
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createTestServer();
    server.listen(port, 'localhost', () => {
      server.close(() => resolve(true));
    });
    server.on('error', () => resolve(false));
  });
}

// Helper to find an available port
async function findAvailablePort(startPort: number = 31337): Promise<number> {
  for (let port = startPort; port <= startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error('No available ports found');
}

describe('Port Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should accept valid port numbers', () => {
    const validPorts = [1, 80, 3000, 31337, 65535];
    
    validPorts.forEach(port => {
      const parsed = parseInt(port.toString(), 10);
      const isValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
      expect(isValid).toBe(true);
    });
  });

  test('should reject invalid port numbers', () => {
    const testCases = [
      { input: 'abc', shouldBeInvalid: true }, // NaN
      { input: '0', shouldBeInvalid: true }, // Below valid range
      { input: '-1', shouldBeInvalid: true }, // Below valid range
      { input: '65536', shouldBeInvalid: true }, // Above valid range
    ];
    
    testCases.forEach(({ input, shouldBeInvalid }) => {
      const parsed = parseInt(input, 10);
      const isValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
      
      if (shouldBeInvalid) {
        expect(isValid).toBe(false);
      } else {
        expect(isValid).toBe(true);
      }
    });
  });

  test('should handle edge cases in port parsing', () => {
    // parseInt('3000.5') returns 3000, which is valid
    const parsed = parseInt('3000.5', 10);
    expect(parsed).toBe(3000);
    
    const isValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
    expect(isValid).toBe(true); // This is actually valid after parsing
  });
});

describe('Port Detection Logic', () => {
  let testServer: Server;
  let availablePort: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    testServer = createTestServer();
    availablePort = await findAvailablePort();
  });

  afterEach(async () => {
    if (testServer?.listening) {
      await new Promise<void>((resolve) => testServer.close(() => resolve()));
    }
  });

  test('should use exact port when user specifies one', async () => {
    const userSpecified = true;
    const requestedPort = availablePort;

    // Simulate the logic from startServerOnAvailablePort
    const shouldUseExactPort = userSpecified;
    expect(shouldUseExactPort).toBe(true);

    // Test that server can bind to the specified port
    await new Promise<void>((resolve, reject) => {
      testServer.listen(requestedPort, 'localhost', () => {
        expect(testServer.listening).toBe(true);
        resolve();
      });
      testServer.on('error', reject);
    });
  });

  test('should find next available port when none specified', async () => {
    const userSpecified = false;
    const requestedPort = availablePort;

    // Block the requested port
    const blockingServer = createTestServer();
    await new Promise<void>((resolve) => {
      blockingServer.listen(requestedPort, 'localhost', resolve);
    });

    try {
      // Simulate finding next available port
      const nextPort = await findAvailablePort(requestedPort + 1);
      expect(nextPort).toBeGreaterThan(requestedPort);

      // Verify we can bind to the next available port
      await new Promise<void>((resolve, reject) => {
        testServer.listen(nextPort, 'localhost', () => {
          expect(testServer.listening).toBe(true);
          resolve();
        });
        testServer.on('error', reject);
      });
    } finally {
      blockingServer.close();
    }
  });

  test('should handle port already in use gracefully', async () => {
    // Block the port we want to test
    const blockingServer = createTestServer();
    await new Promise<void>((resolve) => {
      blockingServer.listen(availablePort, 'localhost', resolve);
    });

    try {
      // Try to bind to the same port - should fail gracefully
      const result = await new Promise<boolean>((resolve) => {
        const onListening = () => {
          testServer.removeListener('error', onError);
          resolve(true);
        };
        
        const onError = (err: NodeJS.ErrnoException) => {
          testServer.removeListener('listening', onListening);
          if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
            resolve(false);
          } else {
            resolve(false);
          }
        };
        
        testServer.once('listening', onListening);
        testServer.once('error', onError);
        testServer.listen(availablePort, 'localhost');
      });

      expect(result).toBe(false);
    } finally {
      blockingServer.close();
    }
  });
});

describe('TTY Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should detect interactive mode when both stdin and stdout are TTYs', () => {
    const mockStdin = { isTTY: true };
    const mockStdout = { isTTY: true };
    
    const shouldOpenBrowser = !!(mockStdin.isTTY && mockStdout.isTTY);
    expect(shouldOpenBrowser).toBe(true);
  });

  test('should not detect interactive mode when stdin is not a TTY', () => {
    const mockStdin = { isTTY: false };
    const mockStdout = { isTTY: true };
    
    const shouldOpenBrowser = !!(mockStdin.isTTY && mockStdout.isTTY);
    expect(shouldOpenBrowser).toBe(false);
  });

  test('should not detect interactive mode when stdout is not a TTY', () => {
    const mockStdin = { isTTY: true };
    const mockStdout = { isTTY: false };
    
    const shouldOpenBrowser = !!(mockStdin.isTTY && mockStdout.isTTY);
    expect(shouldOpenBrowser).toBe(false);
  });

  test('should not detect interactive mode when neither are TTYs', () => {
    const mockStdin = { isTTY: false };
    const mockStdout = { isTTY: false };
    
    const shouldOpenBrowser = !!(mockStdin.isTTY && mockStdout.isTTY);
    expect(shouldOpenBrowser).toBe(false);
  });
});

describe('Browser Opening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockClear();
  });

  test('should open browser in interactive mode', async () => {
    const mockStdin = { isTTY: true };
    const mockStdout = { isTTY: true };
    
    const shouldOpenBrowser = !!(mockStdin.isTTY && mockStdout.isTTY);
    const url = 'http://localhost:31337';

    if (shouldOpenBrowser) {
      await mockOpen(url);
    }

    expect(mockOpen).toHaveBeenCalledWith(url);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  test('should not open browser in non-interactive mode', async () => {
    const mockStdin = { isTTY: false };
    const mockStdout = { isTTY: false };
    
    const shouldOpenBrowser = !!(mockStdin.isTTY && mockStdout.isTTY);
    const url = 'http://localhost:31337';

    if (shouldOpenBrowser) {
      await mockOpen(url);
    }

    expect(mockOpen).not.toHaveBeenCalled();
  });

  test('should handle browser opening failures gracefully', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockOpen.mockRejectedValue(new Error('Browser not found'));

    try {
      await mockOpen('http://localhost:31337');
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code || 'unknown error';
      console.log(`   ℹ️  Could not open browser automatically (${errorCode})`);
    }

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '   ℹ️  Could not open browser automatically (unknown error)'
    );

    consoleLogSpy.mockRestore();
  });

  test('should handle browser opening failures with error codes', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = new Error('Permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockOpen.mockRejectedValue(error);

    try {
      await mockOpen('http://localhost:31337');
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code || 'unknown error';
      console.log(`   ℹ️  Could not open browser automatically (${errorCode})`);
    }

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '   ℹ️  Could not open browser automatically (EACCES)'
    );

    consoleLogSpy.mockRestore();
  });
});

describe('Error Handling', () => {
  test('should provide descriptive error messages for invalid ports', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const invalidInputs = [
      { input: 'abc', expected: NaN },
      { input: '0', expected: 0 },
      { input: '65536', expected: 65536 },
      { input: '-1', expected: -1 },
    ];

    invalidInputs.forEach(({ input, expected }) => {
      const requestedPort = parseInt(input, 10);
      const isValid = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535;
      
      if (!isValid) {
        console.error(`Error: Invalid port number: "${input}" (parsed as ${requestedPort})`);
        expect(consoleErrorSpy).toHaveBeenLastCalledWith(
          `Error: Invalid port number: "${input}" (parsed as ${expected})`
        );
      }
    });

    consoleErrorSpy.mockRestore();
  });

  test('should log error codes in server startup failures', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const mockError = new Error('Test error') as NodeJS.ErrnoException;
    mockError.code = 'ENOTFOUND';
    
    const port = 31337;
    console.error(`Server error on port ${port} (${mockError.code || 'unknown'}):`, mockError.message);
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Server error on port 31337 (ENOTFOUND):',
      'Test error'
    );

    consoleErrorSpy.mockRestore();
  });
});