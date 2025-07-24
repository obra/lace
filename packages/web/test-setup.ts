// ABOUTME: Test setup for vitest
// ABOUTME: Global test configuration and mocks for server-only modules

import { vi } from 'vitest';
// Note: jest-dom setup removed to fix import issues in worktree

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
        model: 'claude-3-haiku-20240307',
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
        model: 'claude-3-haiku-20240307',
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
