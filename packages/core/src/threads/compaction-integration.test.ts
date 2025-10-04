import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from './thread-manager';
import { expectEventAdded } from '@lace/core/test-utils/event-helpers';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';

describe('Compaction Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    threadManager = new ThreadManager();
    threadId = threadManager.createThread();
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  it('creates working conversation without compaction', () => {
    // Add some events
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Hello',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        context: { threadId },
        data: { content: 'Hi there' },
      })
    );

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    expect(workingEvents).toHaveLength(2);
    expect(allEvents).toHaveLength(2);
    expect(workingEvents).toEqual(allEvents);
  });

  it('compacts conversation using trim-tool-results strategy', async () => {
    // Add events including a long tool result
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'List files',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'TOOL_CALL',
        context: { threadId },
        data: {
          id: 'call1',
          name: 'list_files',
          arguments: {},
        },
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'TOOL_RESULT',
        context: { threadId },
        data: {
          id: 'call1',
          content: [
            { type: 'text', text: 'file1.txt\nfile2.txt\nfile3.txt\nfile4.txt\nfile5.txt' },
          ],
          status: 'completed',
        },
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        context: { threadId },
        data: { content: 'Found 5 files' },
      })
    );

    expect(threadManager.getAllEvents(threadId)).toHaveLength(4);

    // Perform compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    // Check results
    const allEvents = threadManager.getAllEvents(threadId);
    const workingEvents = threadManager.getEvents(threadId);

    // After compaction with new architecture:
    // - 4 original events (marked visibleToModel: false)
    // - 4 compacted replacement events (marked visibleToModel: true)
    // - 1 COMPACTION event (marked visibleToModel: false)
    // = 9 total events in getAllEvents()
    expect(allEvents).toHaveLength(9);

    // getEvents() returns only visible events (the 4 compacted replacements)
    expect(workingEvents).toHaveLength(4);

    // Verify working conversation contains compacted versions
    // Note: visibleToModel: true is stored as NULL and read back as undefined
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'List files' })
    );
    expect(workingEvents[0].visibleToModel).not.toBe(false);

    expect(workingEvents[1]).toEqual(expect.objectContaining({ type: 'TOOL_CALL' }));
    expect(workingEvents[1].visibleToModel).not.toBe(false);

    expect(workingEvents[2]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call1',
          content: [
            {
              type: 'text',
              text: 'file1.txt\nfile2.txt\nfile3.txt\n[results truncated to save space.]',
            },
          ],
          status: 'completed',
        }) as unknown,
      })
    );
    expect(workingEvents[2].visibleToModel).not.toBe(false);

    expect(workingEvents[3]).toEqual(
      expect.objectContaining({
        type: 'AGENT_MESSAGE',
        data: { content: 'Found 5 files' },
      })
    );
    expect(workingEvents[3].visibleToModel).not.toBe(false);

    // Verify original events are marked as not visible in allEvents
    const originalEvents = allEvents.filter((e) => e.visibleToModel === false);
    expect(originalEvents.length).toBeGreaterThanOrEqual(5); // 4 original + 1 COMPACTION
  });

  it('continues conversation after compaction', async () => {
    // Set up conversation and compact it
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Hello',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'TOOL_RESULT',
        context: { threadId },
        data: {
          id: 'call-hello',
          content: [{ type: 'text', text: 'line1\nline2\nline3\nline4\nline5' }],
          status: 'completed',
        },
      })
    );

    await threadManager.compact(threadId, 'trim-tool-results');

    // Add more events after compaction
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'What next?',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        context: { threadId },
        data: { content: 'Let me help' },
      })
    );

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    // Working conversation: 2 compacted events + 2 new events = 4 visible events
    expect(workingEvents).toHaveLength(4);

    // All events include:
    // - 2 original events (hidden)
    // - 2 compacted replacement events (visible)
    // - 1 COMPACTION event (hidden)
    // - 2 new events (visible)
    // = 7 total
    expect(allEvents).toHaveLength(7);

    // Verify working conversation contains only visible events
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Hello' })
    );
    expect(workingEvents[0].visibleToModel).not.toBe(false);

    expect(workingEvents[1]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-hello',
          content: [
            { type: 'text', text: 'line1\nline2\nline3\n[results truncated to save space.]' },
          ],
          status: 'completed',
        }) as unknown,
      })
    );
    expect(workingEvents[1].visibleToModel).not.toBe(false);

    expect(workingEvents[2]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'What next?' })
    );
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({ type: 'AGENT_MESSAGE', data: { content: 'Let me help' } })
    );

    // Verify hidden events exist in allEvents
    const hiddenEvents = allEvents.filter((e) => e.visibleToModel === false);
    expect(hiddenEvents).toHaveLength(3); // 2 original + 1 COMPACTION
  });

  it('handles multiple compactions', async () => {
    // Create initial conversation
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Hello',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'TOOL_RESULT',
        context: { threadId },
        data: {
          id: 'call-first',
          content: [{ type: 'text', text: 'long\nresult\nhere\nextra\nlines' }],
          status: 'completed',
        },
      })
    );

    // First compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    // Add more events
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Continue',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'TOOL_RESULT',
        context: { threadId },
        data: {
          id: 'call-second',
          content: [{ type: 'text', text: 'another\nlong\nresult\nwith\nextra\nlines' }],
          status: 'completed',
        },
      })
    );

    // Second compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    // Verify we have 2 COMPACTION events
    const compactionEvents = allEvents.filter((e) => e.type === 'COMPACTION');
    expect(compactionEvents).toHaveLength(2);

    // All events structure with new architecture:
    // First compaction creates: 2 original (hidden) + 2 compacted (visible) + 1 COMPACTION (hidden)
    // Then add: 2 new events (visible)
    // Second compaction marks: 2 compacted from first + 2 new = 4 events as hidden
    // And creates: 4 new compacted replacements (visible) + 1 COMPACTION (hidden)
    // Total: 2 + 2 + 1 + 2 + 4 + 1 = 12 events
    expect(allEvents.length).toBeGreaterThanOrEqual(12);

    // Working events should only contain the latest compacted versions (4 events)
    expect(workingEvents).toHaveLength(4);

    // Verify working conversation has the compacted versions from second compaction
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({
        type: 'USER_MESSAGE',
        data: 'Hello',
      })
    );
    expect(workingEvents[0].visibleToModel).not.toBe(false);

    expect(workingEvents[1]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-first',
          content: [
            { type: 'text', text: 'long\nresult\nhere\n[results truncated to save space.]' },
          ],
          status: 'completed',
        }) as unknown,
      })
    );
    expect(workingEvents[1].visibleToModel).not.toBe(false);

    expect(workingEvents[2]).toEqual(
      expect.objectContaining({
        type: 'USER_MESSAGE',
        data: 'Continue',
      })
    );
    expect(workingEvents[2].visibleToModel).not.toBe(false);

    expect(workingEvents[3]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-second',
          content: [
            { type: 'text', text: 'another\nlong\nresult\n[results truncated to save space.]' },
          ],
          status: 'completed',
        }) as unknown,
      })
    );
    expect(workingEvents[3].visibleToModel).not.toBe(false);

    // Verify all working events are visible (visibleToModel !== false)
    expect(workingEvents.every((e) => e.visibleToModel !== false)).toBe(true);

    // Verify both COMPACTION events are hidden
    expect(compactionEvents.every((e) => e.visibleToModel === false)).toBe(true);
  });

  it('throws error for unknown strategy', async () => {
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Hello',
      })
    );

    await expect(threadManager.compact(threadId, 'unknown-strategy')).rejects.toThrow(
      'Unknown compaction strategy: unknown-strategy'
    );
  });

  it('throws error for non-existent thread', async () => {
    await expect(threadManager.compact('non-existent-thread', 'trim-tool-results')).rejects.toThrow(
      'Thread non-existent-thread not found'
    );
  });

  it('auto-registers default strategies', () => {
    const newThreadManager = new ThreadManager();
    const newThreadId = newThreadManager.createThread();

    // Should be able to use the trim-tool-results strategy without manual registration
    expectEventAdded(
      newThreadManager.addEvent({
        type: 'TOOL_RESULT',
        context: { threadId: newThreadId },
        data: {
          id: 'call-auto',
          content: [{ type: 'text', text: 'line1\nline2\nline3\nline4' }],
          status: 'completed',
        },
      })
    );

    expect(async () => {
      await newThreadManager.compact(newThreadId, 'trim-tool-results');
    }).not.toThrow();
  });

  it('preserves event order in compacted conversation', async () => {
    // Add events in specific order
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'First message',
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        context: { threadId },
        data: { content: 'First response' },
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'TOOL_RESULT',
        context: { threadId },
        data: {
          id: 'call-order',
          content: [{ type: 'text', text: 'long\ntool\nresult\nwith\nmany\nlines' }],
          status: 'completed',
        },
      })
    );
    expectEventAdded(
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Second message',
      })
    );

    await threadManager.compact(threadId, 'trim-tool-results');

    const workingEvents = threadManager.getEvents(threadId);

    // Working events should only contain visible compacted versions
    expect(workingEvents).toHaveLength(4);

    // Check that order is preserved in compacted versions
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({
        type: 'USER_MESSAGE',
        data: 'First message',
      })
    );
    expect(workingEvents[0].visibleToModel).not.toBe(false);

    expect(workingEvents[1]).toEqual(
      expect.objectContaining({
        type: 'AGENT_MESSAGE',
        data: { content: 'First response' },
      })
    );
    expect(workingEvents[1].visibleToModel).not.toBe(false);

    expect(workingEvents[2]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
      })
    );
    expect(workingEvents[2].visibleToModel).not.toBe(false);
    expect((workingEvents[2].data as { content: Array<{ text: string }> }).content[0].text).toBe(
      'long\ntool\nresult\n[results truncated to save space.]'
    );

    expect(workingEvents[3]).toEqual(
      expect.objectContaining({
        type: 'USER_MESSAGE',
        data: 'Second message',
      })
    );
    expect(workingEvents[3].visibleToModel).not.toBe(false);
  });
});
