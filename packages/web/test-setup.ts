// ABOUTME: Test setup for vitest
// ABOUTME: Global test configuration and mocks for server-only modules

import { vi, afterAll, afterEach } from 'vitest';
import '@testing-library/jest-dom';

// Import superjson to ensure it's available in test environment
import 'superjson';

// Mock EventSource for SSE testing
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = MockEventSource.OPEN;
  url = '';
  withCredentials = false;

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    this.url = url;
    this.withCredentials = eventSourceInitDict?.withCredentials ?? false;
  }
}

global.EventSource = MockEventSource as any;

// Mock server-only to avoid import issues in tests
// This is the current workaround as suggested in Next.js GitHub issue #60038
vi.mock('server-only', () => {
  return {};
});

// Mock the Anthropic SDK globally to prevent real API calls in all tests
vi.mock('@anthropic-ai/sdk', () => {
  // Create a proper mock stream type
  interface MockEventEmitter {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
    finalMessage: () => Promise<{
      id: string;
      role: string;
      content: Array<{ type: string; text: string }>;
      model: string;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  }

  const createMockStream = (): MockEventEmitter => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    return {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        if (!listeners[event]) {
          listeners[event] = [];
        }
        listeners[event].push(listener);
      },
      emit: (event: string, ...args: unknown[]) => {
        if (listeners[event]) {
          listeners[event].forEach((listener) => listener(...args));
        }
      },
      finalMessage: vi.fn().mockResolvedValue({
        id: 'msg_test',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! This is a test response.' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
    };
  };

  const mockClient = {
    messages: {
      stream: vi.fn().mockImplementation(() => {
        const mockStream = createMockStream();

        setTimeout(() => {
          mockStream.emit('text', 'Hello! ');
          mockStream.emit('text', 'This is a test response.');
          mockStream.emit('end');
        }, 10);

        return mockStream;
      }),
      create: vi.fn().mockResolvedValue({
        id: 'msg_test',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! This is a test response.' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
    },
  };

  return {
    __esModule: true,
    default: vi.fn().mockImplementation(() => mockClient),
    Anthropic: vi.fn().mockImplementation(() => mockClient),
  };
});

// Global cleanup after each test file
afterAll(() => {
  // Clear all timers (both real and fake)
  // Strategy: Get the next timer ID by creating a temporary timer, then clear all
  // timers from 1 to that ID. This handles cases where tests create timers but
  // don't properly clean them up, which can prevent the Node.js process from exiting.
  // This approach works because Node.js timer IDs are incrementing integers.
  if (typeof globalThis.clearTimeout === 'function') {
    const maxId = Number(setTimeout(() => {}, 0));
    for (let i = 1; i <= maxId; i++) {
      clearTimeout(i);
      clearInterval(i);
    }
  }

  // Force garbage collection to clean up any remaining references
  // This helps ensure EventEmitters and other objects are properly collected
  if (global.gc) {
    global.gc();
  }
});

// Mock console methods to prevent test noise
// Save original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

// Set up global console mocking
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});

// Helper to restore console for debugging if needed
(globalThis as unknown as { restoreConsole: () => void }).restoreConsole = () => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
};

// Cleanup after each individual test
afterEach(() => {
  // Reset all vitest mocks and timers
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});
