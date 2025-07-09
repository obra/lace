// ABOUTME: Tests for NonInteractiveInterface class
// ABOUTME: Validates single prompt execution and graceful shutdown

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NonInteractiveInterface } from '../non-interactive-interface.js';
import type { Agent } from '../../agents/agent.js';
import { EventEmitter } from 'events';
import { withConsoleCapture } from '../../__tests__/setup/console-capture.js';

// Mock dependencies

describe('NonInteractiveInterface', () => {
  let agent: Agent;
  let nonInteractive: NonInteractiveInterface;
  let mockEventEmitter: EventEmitter;

  beforeEach(() => {
    // Create event emitter for agent events
    mockEventEmitter = new EventEmitter();

    // Create mock dependencies with EventEmitter methods
    agent = {
      providerName: 'mock-provider',
      start: vi.fn(),
      sendMessage: vi.fn().mockImplementation(async () => {
        // Simulate agent events during sendMessage
        setTimeout(() => {
          mockEventEmitter.emit('agent_token', { token: 'Test response' });
          mockEventEmitter.emit('agent_response_complete', { content: 'Test response' });
          mockEventEmitter.emit('conversation_complete');
        }, 10);
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
    vi.clearAllMocks();
  });

  describe('executePrompt', () => {
    it('should execute single prompt and exit gracefully', async () => {
      const agentStartSpy = vi.spyOn(agent, 'start').mockImplementation(async () => {});
      const { log } = withConsoleCapture();

      await nonInteractive.executePrompt('Test prompt');

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('using mock-provider provider')
      );
      expect(agentStartSpy).toHaveBeenCalled();
      expect(agent.sendMessage).toHaveBeenCalledWith('Test prompt');
    });

    it('should handle errors during prompt execution', async () => {
      vi.spyOn(agent, 'sendMessage').mockRejectedValue(new Error('Test error'));
      vi.spyOn(agent, 'start').mockImplementation(async () => {});

      await expect(nonInteractive.executePrompt('Test prompt')).rejects.toThrow('Test error');
    });

    it('should display provider information', async () => {
      vi.spyOn(agent, 'start').mockImplementation(async () => {});
      const { log } = withConsoleCapture();

      await nonInteractive.executePrompt('Test prompt');

      expect(log).toHaveBeenCalledWith('🤖 Lace Agent using mock-provider provider.\n');
    });

    it('should work without tool executor', async () => {
      const nonInteractiveWithoutTools = new NonInteractiveInterface(agent);
      vi.spyOn(agent, 'start').mockImplementation(async () => {});

      await nonInteractiveWithoutTools.executePrompt('Test prompt');

      expect(agent.start).toHaveBeenCalled();
      expect(agent.sendMessage).toHaveBeenCalledWith('Test prompt');
    });
  });
});
