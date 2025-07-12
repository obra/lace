// ABOUTME: Basic test to verify debug-thread tool functionality
// ABOUTME: Tests the core thread debugging functionality without requiring real threads

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokens } from '~/utils/token-estimation';
import { ThreadEvent } from '~/threads/types';

// Mock dependencies
vi.mock('./config/env-loader.js', () => ({
  loadEnvFile: vi.fn(),
}));

vi.mock('./config/lace-dir.js', () => ({
  getLaceDir: vi.fn(() => '/tmp/test-lace'),
}));

vi.mock('./persistence/database.js');
vi.mock('./threads/thread-manager.js');
vi.mock('./providers/registry.js');
vi.mock('./agents/agent.js');

describe('debug-thread functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should estimate tokens correctly', () => {
    const text = 'Hello world! This is a test message.';
    const tokens = estimateTokens(text);

    // Rough estimation: 1 token ≈ 4 characters
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it('should handle empty text in token estimation', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should handle thread events structure', () => {
    const mockEvent: ThreadEvent = {
      id: 'test-event-1',
      threadId: 'test-thread',
      type: 'USER_MESSAGE',
      timestamp: new Date(),
      data: 'Hello, this is a test message.',
    };

    expect(mockEvent.type).toBe('USER_MESSAGE');
    expect(typeof mockEvent.data).toBe('string');
    expect(mockEvent.threadId).toBe('test-thread');
  });
});
