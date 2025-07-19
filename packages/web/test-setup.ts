// ABOUTME: Test setup for vitest
// ABOUTME: Global test configuration and mocks for server-only modules

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend expect with jest-dom matchers
expect.extend(matchers);

// Mock server-only to avoid import issues in tests
// This is the current workaround as suggested in Next.js GitHub issue #60038
vi.mock('server-only', () => {
  return {};
});

// Mock the Anthropic SDK globally to prevent real API calls in all tests
vi.mock('@anthropic-ai/sdk', () => {
  const mockClient = {
    messages: {
      stream: vi.fn().mockImplementation(() => {
        const EventEmitter = require('events');
        const mockStream = new EventEmitter();

        mockStream.finalMessage = vi.fn().mockResolvedValue({
          id: 'msg_test',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! This is a test response.' }],
          model: 'claude-3-haiku-20240307',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 8 },
        });

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

// Ensure global expects are available for all tests
(global as typeof globalThis & { expect: typeof expect }).expect = expect;
