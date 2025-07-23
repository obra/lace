// ABOUTME: Test for race condition in NonInteractiveInterface error handling
// ABOUTME: Ensures errors from sendMessage don't bypass the conversationComplete promise

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NonInteractiveInterface } from '~/interfaces/non-interactive-interface';
import { Agent } from '~/agents/agent';
import { EventEmitter } from 'events';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('NonInteractiveInterface Race Condition', () => {
  beforeEach(() => {
    setupTestPersistence();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should handle errors from sendMessage without hanging', async () => {
    // Create a mock agent that throws an error from sendMessage
    const mockEventEmitter = new EventEmitter();
    const mockAgent = {
      providerName: 'test-provider',
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockRejectedValue(new Error('Provider connection failed')),
      // EventEmitter methods
      once: mockEventEmitter.once.bind(mockEventEmitter),
      on: mockEventEmitter.on.bind(mockEventEmitter),
      off: mockEventEmitter.off.bind(mockEventEmitter),
      emit: mockEventEmitter.emit.bind(mockEventEmitter),
    } as unknown as Agent;

    const nonInteractive = new NonInteractiveInterface(mockAgent);

    // This should reject with the error, not hang indefinitely
    await expect(nonInteractive.executePrompt('test prompt')).rejects.toThrow(
      'Provider connection failed'
    );

    // Should not hang - test will timeout if it does
  }, 5000); // 5 second timeout to catch hanging
});
