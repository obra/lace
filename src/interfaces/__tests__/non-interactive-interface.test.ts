// ABOUTME: Tests for NonInteractiveInterface class
// ABOUTME: Validates single prompt execution and graceful shutdown

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NonInteractiveInterface } from '../non-interactive-interface.js';
import type { Agent } from '../../agents/agent.js';
import type { ThreadManager } from '../../threads/thread-manager.js';
import type { ToolExecutor } from '../../tools/executor.js';

// Mock dependencies

describe('NonInteractiveInterface', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let nonInteractive: NonInteractiveInterface;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock console.log to capture output
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create mock dependencies
    agent = {
      providerName: 'mock-provider',
      start: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    threadManager = {
      getCurrentThreadId: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ThreadManager;

    toolExecutor = {} as ToolExecutor;

    nonInteractive = new NonInteractiveInterface(agent, threadManager, toolExecutor);
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockRestore();
  });

  describe('executePrompt', () => {
    it('should execute single prompt and exit gracefully', async () => {
      const agentSendSpy = vi.spyOn(agent, 'sendMessage').mockResolvedValue();
      const agentStartSpy = vi.spyOn(agent, 'start').mockImplementation(() => {});

      await nonInteractive.executePrompt('Test prompt');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('using mock-provider provider')
      );
      expect(agentStartSpy).toHaveBeenCalled();
      expect(agentSendSpy).toHaveBeenCalledWith('Test prompt');
    });

    it('should handle errors during prompt execution', async () => {
      vi.spyOn(agent, 'sendMessage').mockRejectedValue(new Error('Test error'));
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      await expect(nonInteractive.executePrompt('Test prompt')).rejects.toThrow('Test error');
    });

    it('should display provider information', async () => {
      vi.spyOn(agent, 'sendMessage').mockResolvedValue();
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      await nonInteractive.executePrompt('Test prompt');

      expect(consoleSpy).toHaveBeenCalledWith('🤖 Lace Agent using mock-provider provider.\n');
    });

    it('should work without tool executor', async () => {
      const nonInteractiveWithoutTools = new NonInteractiveInterface(agent, threadManager);

      vi.spyOn(agent, 'sendMessage').mockResolvedValue();
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      await nonInteractiveWithoutTools.executePrompt('Test prompt');

      expect(agent.start).toHaveBeenCalled();
      expect(agent.sendMessage).toHaveBeenCalledWith('Test prompt');
    });
  });
});
