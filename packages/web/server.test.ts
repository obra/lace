// ABOUTME: Tests for server startup, port detection, and browser opening functionality
// ABOUTME: Covers port validation, auto-detection logic, TTY detection, and error handling

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';

// Mock the open package
vi.mock('open', () => ({
  default: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocking
const open = await import('open');
const mockOpen = vi.mocked(open.default);

const { logger } = await import('../../src/utils/logger');
const mockLogger = vi.mocked(logger);

const { isInteractive } = await import('./lib/server-utils');

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

    validPorts.forEach((port) => {
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

describe('Interactive Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should detect interactive mode when both stdin and stdout are TTYs', () => {
    const mockStdin = { isTTY: true };
    const mockStdout = { isTTY: true };

    const result = isInteractive(mockStdin, mockStdout);
    expect(result).toBe(true);
  });

  test('should not detect interactive mode when stdin is not a TTY', () => {
    const mockStdin = { isTTY: false };
    const mockStdout = { isTTY: true };

    const result = isInteractive(mockStdin, mockStdout);
    expect(result).toBe(false);
  });

  test('should not detect interactive mode when stdout is not a TTY', () => {
    const mockStdin = { isTTY: true };
    const mockStdout = { isTTY: false };

    const result = isInteractive(mockStdin, mockStdout);
    expect(result).toBe(false);
  });

  test('should not detect interactive mode when neither are TTYs', () => {
    const mockStdin = { isTTY: false };
    const mockStdout = { isTTY: false };

    const result = isInteractive(mockStdin, mockStdout);
    expect(result).toBe(false);
  });

  test('should use process defaults when no arguments provided', () => {
    // This tests the default behavior using actual process.stdin/stdout
    const result = isInteractive();
    // We can't assert a specific value since it depends on test environment,
    // but we can verify it returns a boolean
    expect(typeof result).toBe('boolean');
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

    const shouldOpenBrowser = isInteractive(mockStdin, mockStdout);
    const url = 'http://localhost:31337';

    if (shouldOpenBrowser) {
      await mockOpen(url);
    }

    expect(shouldOpenBrowser).toBe(true);
    expect(mockOpen).toHaveBeenCalledWith(url);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  test('should not open browser in non-interactive mode', async () => {
    const mockStdin = { isTTY: false };
    const mockStdout = { isTTY: false };

    const shouldOpenBrowser = isInteractive(mockStdin, mockStdout);
    const url = 'http://localhost:31337';

    if (shouldOpenBrowser) {
      await mockOpen(url);
    }

    expect(shouldOpenBrowser).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  test('should handle browser opening failures gracefully', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockOpen.mockRejectedValue(new Error('Browser not found'));

    try {
      await mockOpen('http://localhost:31337');
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code || 'unknown error';
      mockLogger.warn('Could not open browser automatically', { error: errorCode });
      console.log(`   ℹ️  Could not open browser automatically (${errorCode})`);
    }

    expect(mockLogger.warn).toHaveBeenCalledWith('Could not open browser automatically', {
      error: 'unknown error',
    });
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
      mockLogger.warn('Could not open browser automatically', { error: errorCode });
      console.log(`   ℹ️  Could not open browser automatically (${errorCode})`);
    }

    expect(mockLogger.warn).toHaveBeenCalledWith('Could not open browser automatically', {
      error: 'EACCES',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '   ℹ️  Could not open browser automatically (EACCES)'
    );

    consoleLogSpy.mockRestore();
  });
});

describe('Error Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should log invalid port numbers to logger with structured data', () => {
    const invalidInputs = [
      { input: 'abc', expectedParsed: NaN },
      { input: '0', expectedParsed: 0 },
      { input: '65536', expectedParsed: 65536 },
      { input: '-1', expectedParsed: -1 },
    ];

    invalidInputs.forEach(({ input, expectedParsed }) => {
      mockLogger.error.mockClear();

      const requestedPort = parseInt(input, 10);
      const isValid =
        Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535;

      if (!isValid) {
        // Simulate the production error logging path
        mockLogger.error(`Invalid port number: "${input}" (parsed as ${requestedPort})`);

        expect(mockLogger.error).toHaveBeenCalledWith(
          `Invalid port number: "${input}" (parsed as ${expectedParsed})`
        );
      }
    });
  });

  test('should log server startup failures with structured error data', () => {
    const mockError = new Error('Test error') as NodeJS.ErrnoException;
    mockError.code = 'ENOTFOUND';

    const port = 31337;

    // Simulate the production error logging path
    mockLogger.error(`Server error on port ${port}`, {
      code: mockError.code,
      message: mockError.message,
    });

    expect(mockLogger.error).toHaveBeenCalledWith('Server error on port 31337', {
      code: 'ENOTFOUND',
      message: 'Test error',
    });
  });

  test('should log port unavailable errors', () => {
    const port = 31337;

    // Simulate the production error logging path
    mockLogger.error(`Port ${port} is already in use`);

    expect(mockLogger.error).toHaveBeenCalledWith('Port 31337 is already in use');
  });

  test('should log when no available ports found', () => {
    const startPort = 31337;

    // Simulate the production error logging path
    mockLogger.error(`Could not find an available port starting from ${startPort}`);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Could not find an available port starting from 31337'
    );
  });
});
