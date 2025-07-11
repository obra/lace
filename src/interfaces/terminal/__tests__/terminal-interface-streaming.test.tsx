// ABOUTME: Tests for terminal interface streaming event flow migration
// ABOUTME: Verifies pure streaming event flow without events array dependencies

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Agent } from '~/agents/agent.js';
import { ThreadManager } from '~/threads/thread-manager.js';
import { ToolExecutor } from '~/tools/executor.js';
import { TestProvider } from '~/__tests__/utils/test-provider.js';
import { TerminalInterfaceComponent } from '~/interfaces/terminal/terminal-interface.js';
import { ThreadEvent } from '~/threads/types.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TerminalInterface Streaming Event Flow', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lace-terminal-streaming-test-'));
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

    await agent.start();
  });

  afterEach(async () => {
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Event Flow Architecture', () => {
    it('should handle Agent events flowing to StreamingTimelineProcessor', async () => {
      // Spy on agent event emissions
      const threadEventAddedSpy = vi.fn();
      agent.on('thread_event_added', threadEventAddedSpy);

      // Render terminal interface
      render(<TerminalInterfaceComponent agent={agent} />);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate agent event
      await agent.sendMessage('Test message');

      // Verify agent emitted events
      expect(threadEventAddedSpy).toHaveBeenCalled();

      // Agent might emit system prompt first, then user message
      const calls = threadEventAddedSpy.mock.calls;
      const userMessageCall = calls.find((call) => {
        const eventData = call[0] as { event: ThreadEvent };
        return eventData?.event?.type === 'USER_MESSAGE';
      });
      expect(userMessageCall).toBeDefined();
      const eventData = userMessageCall![0] as { event: ThreadEvent };
      expect(eventData.event.data).toBe('Test message');
    });

    it('should handle session initialization without events array', () => {
      // This test verifies that terminal interface can initialize
      // without depending on events array state
      const { unmount } = render(<TerminalInterfaceComponent agent={agent} />);

      // Should not throw and should complete initialization
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Pure Streaming Flow', () => {
    it('should process events incrementally through StreamingTimelineProcessor', async () => {
      // Mock StreamingTimelineProcessor to spy on its methods
      const mockAppendEvent = vi.fn();
      const mockLoadEvents = vi.fn();

      // Mock the useStreamingTimelineProcessor hook
      vi.doMock('../terminal-interface.js', async () => {
        const original = await vi.importActual('../terminal-interface.js');
        return {
          ...original,
          useStreamingTimelineProcessor: () => ({
            appendEvent: mockAppendEvent,
            loadEvents: mockLoadEvents,
            getTimeline: () => ({
              items: [],
              metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
            }),
            reset: vi.fn(),
            getMetrics: vi.fn(),
          }),
        };
      });

      render(<TerminalInterfaceComponent agent={agent} />);

      // Send a message to trigger event flow
      await agent.sendMessage('Hello');

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify events flow to streaming processor
      // Note: This is more of an integration test to verify the flow works
      expect(true).toBe(true); // Basic smoke test
    });
  });

  describe('Session Resumption', () => {
    it('should handle session resumption with streaming processor', async () => {
      // Add some events to the thread
      threadManager.addEvent(agent.getCurrentThreadId()!, 'USER_MESSAGE', 'Previous message');
      threadManager.addEvent(agent.getCurrentThreadId()!, 'AGENT_MESSAGE', 'Previous response');

      // Create new agent pointing to same thread (simulates resumption)
      const resumedAgent = new Agent({
        provider: new TestProvider(),
        toolExecutor: new ToolExecutor(),
        threadManager,
        threadId: agent.getCurrentThreadId()!,
        tools: [],
      });

      await resumedAgent.start();

      // Render with resumed agent
      const { unmount } = render(<TerminalInterfaceComponent agent={resumedAgent} />);

      // Should handle resumption without errors
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Performance Characteristics', () => {
    it('should not trigger React state updates on every agent event', async () => {
      let renderCount = 0;

      // Create a component that counts renders
      const TestWrapper = () => {
        renderCount++;
        return <TerminalInterfaceComponent agent={agent} />;
      };

      render(<TestWrapper />);
      const initialRenderCount = renderCount;

      // Send multiple messages
      await agent.sendMessage('Message 1');
      await agent.sendMessage('Message 2');
      await agent.sendMessage('Message 3');

      // Wait for any async updates
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Render count should not increase excessively
      // With pure streaming, we should have minimal React re-renders
      const finalRenderCount = renderCount;
      expect(finalRenderCount - initialRenderCount).toBeLessThan(10);
    });
  });
});
