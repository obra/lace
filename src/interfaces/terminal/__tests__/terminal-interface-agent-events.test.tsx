// ABOUTME: Unit tests for terminal interface Agent event integration
// ABOUTME: Tests verify terminal interface subscribes to Agent events for thread updates

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { TerminalInterfaceComponent } from '~/interfaces/terminal/terminal-interface';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TerminalInterface Agent Events', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lace-terminal-test-'));
    threadManager = new ThreadManager(join(testDir, 'test.db'));

    const provider = new TestProvider();
    const toolExecutor = new ToolExecutor();
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    // Mock Agent methods to avoid database calls during rendering
    vi.spyOn(agent, 'getMainAndDelegateEvents').mockReturnValue([]);
    vi.spyOn(agent, 'getThreadEvents').mockReturnValue([]);
    vi.spyOn(agent, 'getCurrentThreadId').mockReturnValue(threadId);

    await agent.start();
  });

  afterEach(async () => {
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('event subscriptions', () => {
    it('should subscribe to Agent thread_event_added events', async () => {
      // Arrange
      const onSpy = vi.spyOn(agent, 'on');

      // Act
      render(<TerminalInterfaceComponent agent={agent} />);

      // Wait for all effects to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Assert - Should subscribe to Agent events
      expect(onSpy).toHaveBeenCalledWith('thread_event_added', expect.any(Function));
    });

    it('should use Agent API for thread operations', () => {
      // Verifies ThreadManager operates as pure data layer without event methods

      // Act
      render(<TerminalInterfaceComponent agent={agent} />);

      // Assert - ThreadManager should not have event emitter methods
      expect(typeof (threadManager as unknown as { on?: unknown }).on).toBe('undefined');
      expect(typeof (threadManager as unknown as { emit?: unknown }).emit).toBe('undefined');
    });
  });

  describe('thread operations through Agent API', () => {
    it('should use Agent.getCurrentThreadId() instead of direct ThreadManager access', () => {
      // Arrange
      const agentGetCurrentThreadIdSpy = vi.spyOn(agent, 'getCurrentThreadId');

      // Act
      render(<TerminalInterfaceComponent agent={agent} />);

      // Assert - Should use Agent API
      expect(agentGetCurrentThreadIdSpy).toHaveBeenCalled();
    });

    it('should use Agent.getThreadEvents() instead of direct ThreadManager access', async () => {
      // Arrange
      const agentGetThreadEventsSpy = vi.spyOn(agent, 'getThreadEvents');

      // Act
      render(<TerminalInterfaceComponent agent={agent} />);

      // Wait for all effects to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Assert - Should use Agent API
      expect(agentGetThreadEventsSpy).toHaveBeenCalled();
    });
  });
});
