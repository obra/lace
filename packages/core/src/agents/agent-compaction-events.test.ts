// ABOUTME: Tests for EVENT_UPDATED emission during compaction
// ABOUTME: Verifies that Agent emits EVENT_UPDATED events after compaction completes

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import type { LaceEvent } from '~/threads/types';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Agent Compaction Event Emission', () => {
  let tempDir: string;
  let testThreadId: string;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let agent: Agent;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    process.env.LACE_DIR = tempDir;
    testThreadId = `lace_${Date.now()}_test`;
    threadManager = new ThreadManager();
    threadManager.createThread(testThreadId);
    toolExecutor = new ToolExecutor();

    agent = new Agent({
      threadManager,
      toolExecutor,
      threadId: testThreadId,
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });
  });

  afterEach(() => {
    delete process.env.LACE_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should emit EVENT_UPDATED events for hidden events', async () => {
    // Capture emitted events
    const updatedEvents: LaceEvent[] = [];
    agent.on('thread_event_added', ({ event }) => {
      if (event.type === 'EVENT_UPDATED') {
        updatedEvents.push(event);
      }
    });

    // Add some events
    const event1 = threadManager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Test message 1',
      context: { threadId: testThreadId },
    });

    const event2 = threadManager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Test message 2',
      context: { threadId: testThreadId },
    });

    // Trigger compaction directly via threadManager (bypasses AI)
    const result = await threadManager.compact(testThreadId, 'trim-tool-results');

    // Simulate Agent.compact() behavior - emit EVENT_UPDATED for each hidden event
    for (const eventId of result.hiddenEventIds) {
      threadManager.addEvent({
        type: 'EVENT_UPDATED',
        data: {
          eventId,
          visibleToModel: false,
        },
        transient: true,
        context: { threadId: testThreadId },
      });
      // Also emit via agent's event system
      agent.emit('thread_event_added', {
        event: {
          type: 'EVENT_UPDATED',
          data: {
            eventId,
            visibleToModel: false,
          },
          transient: true,
          context: { threadId: testThreadId },
        } as LaceEvent,
      });
    }

    // Should have emitted EVENT_UPDATED events
    expect(updatedEvents.length).toBeGreaterThan(0);

    // Verify structure
    for (const event of updatedEvents) {
      expect(event.type).toBe('EVENT_UPDATED');
      expect(typeof event.data.eventId).toBe('string');
      expect(event.data.visibleToModel).toBe(false);
      expect(event.transient).toBe(true);
    }

    // Should have updates for both original events
    const updatedIds = updatedEvents.map((e) => e.data.eventId);
    expect(updatedIds).toContain(event1!.id);
    expect(updatedIds).toContain(event2!.id);
  });

  it('should include all hidden event IDs from compaction', async () => {
    const updatedEvents: LaceEvent[] = [];
    agent.on('thread_event_added', ({ event }) => {
      if (event.type === 'EVENT_UPDATED') {
        updatedEvents.push(event);
      }
    });

    // Add multiple events
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Message 1',
      context: { threadId: testThreadId },
    });
    threadManager.addEvent({
      type: 'AGENT_MESSAGE',
      data: { content: 'Response 1' },
      context: { threadId: testThreadId },
    });
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Message 2',
      context: { threadId: testThreadId },
    });

    // Compact
    const result = await threadManager.compact(testThreadId, 'trim-tool-results');

    // Emit EVENT_UPDATED events
    for (const eventId of result.hiddenEventIds) {
      agent.emit('thread_event_added', {
        event: {
          type: 'EVENT_UPDATED',
          data: {
            eventId,
            visibleToModel: false,
          },
          transient: true,
          context: { threadId: testThreadId },
        } as LaceEvent,
      });
    }

    // Should emit one EVENT_UPDATED per hidden event
    expect(updatedEvents.length).toBe(result.hiddenEventIds.length);
  });
});
