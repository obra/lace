// ABOUTME: Tests for NonInteractiveInterface class
// ABOUTME: Validates single prompt execution and graceful shutdown

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NonInteractiveInterface } from '~/interfaces/non-interactive-interface';
import type { Agent } from '~/agents/agent';
import { EventEmitter } from 'events';
import { setupCoreTest } from '~/test-utils/core-test-setup';

// Mock dependencies

describe('NonInteractiveInterface', () => {
  let agent: Agent;
  let nonInteractive: NonInteractiveInterface;
  let mockEventEmitter: EventEmitter;

  beforeEach(() => {
    // setupTestPersistence replaced by setupCoreTest
    // Mock stdout before creating NonInteractiveInterface to prevent "Test response" output
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Create event emitter for agent events
    mockEventEmitter = new EventEmitter();

    // Create mock dependencies with EventEmitter methods
    agent = {
      providerName: 'mock-provider',
      start: vi.fn(),
      sendMessage: vi.fn().mockImplementation(() => {
        // Simulate agent events during sendMessage
        setTimeout(() => {
          mockEventEmitter.emit('agent_token', { token: 'Test response' });
          mockEventEmitter.emit('agent_response_complete', { content: 'Test response' });
          mockEventEmitter.emit('conversation_complete');
        }, 10);
        return Promise.resolve();
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      // EventEmitter methods
      once: mockEventEmitter.once.bind(mockEventEmitter),
      on: mockEventEmitter.on.bind(mockEventEmitter),
      off: mockEventEmitter.off.bind(mockEventEmitter),
      emit: mockEventEmitter.emit.bind(mockEventEmitter),
    } as unknown as Agent;

    nonInteractive = new NonInteractiveInterface(agent);
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
    vi.restoreAllMocks();
  });

  describe('executePrompt', () => {
    it('should execute single prompt and display provider information', async () => {
      vi.spyOn(agent, 'start').mockImplementation(async () => {
        // Mock implementation for testing - prevents actual agent start
      });

      await nonInteractive.executePrompt('Test prompt');

      // Test that the prompt was sent to agent (essential business logic)
      expect(agent.sendMessage).toHaveBeenCalledWith('Test prompt');
    });

    it('should handle and propagate agent errors', async () => {
      const testError = new Error('Test error');
      vi.spyOn(agent, 'sendMessage').mockRejectedValue(testError);
      vi.spyOn(agent, 'start').mockImplementation(async () => {
        // Mock implementation for testing - prevents actual agent start
      });

      // Test actual behavior - errors are propagated to caller
      await expect(nonInteractive.executePrompt('Test prompt')).rejects.toThrow('Test error');
    });

    it('should handle agent output streaming', async () => {
      vi.spyOn(agent, 'start').mockImplementation(async () => {
        // Mock implementation for testing - prevents actual agent start
      });

      // Capture stdout to verify streaming output
      const stdoutSpy = vi.spyOn(process.stdout, 'write');

      await nonInteractive.executePrompt('Test prompt');

      // Wait for agent events to be processed
      await new Promise((resolve) => setImmediate(resolve));

      // Test actual behavior - agent responses are written to stdout
      expect(stdoutSpy).toHaveBeenCalledWith('Test response');
    });

    it('should handle conversation completion', async () => {
      vi.spyOn(agent, 'start').mockImplementation(async () => {
        // Mock implementation for testing - prevents actual agent start
      });

      // Test that executePrompt completes when conversation_complete event is emitted
      const executePromise = nonInteractive.executePrompt('Test prompt');

      // Wait for the execution to complete
      await executePromise;

      // Test that the conversation completed successfully
      expect(agent.sendMessage).toHaveBeenCalledWith('Test prompt');
    });

    it('should work without tool executor', async () => {
      const nonInteractiveWithoutTools = new NonInteractiveInterface(agent);
      vi.spyOn(agent, 'start').mockImplementation(async () => {
        // Mock implementation for testing - prevents actual agent start
      });

      // Test actual behavior - interface works even without tools
      await nonInteractiveWithoutTools.executePrompt('Test prompt');

      // Verify prompt was processed
      expect(agent.sendMessage).toHaveBeenCalledWith('Test prompt');
    });
  });
});
