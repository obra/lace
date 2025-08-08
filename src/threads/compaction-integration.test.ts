import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { expectEventAdded } from '~/test-utils/event-helpers';
import { setupCoreTest } from '~/test-utils/core-test-setup';

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
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello'));
    expectEventAdded(threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there'));

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    expect(workingEvents).toHaveLength(2);
    expect(allEvents).toHaveLength(2);
    expect(workingEvents).toEqual(allEvents);
  });

  it('compacts conversation using trim-tool-results strategy', async () => {
    // Add events including a long tool result
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'List files'));
    expectEventAdded(
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        id: 'call1',
        name: 'list_files',
        arguments: {},
      })
    );
    expectEventAdded(
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        id: 'call1',
        content: [{ type: 'text', text: 'file1.txt\nfile2.txt\nfile3.txt\nfile4.txt\nfile5.txt' }],
        isError: false,
      })
    );
    expectEventAdded(
      threadManager.addEvent(threadId, 'AGENT_MESSAGE', { content: 'Found 5 files' })
    );

    expect(threadManager.getAllEvents(threadId)).toHaveLength(4);

    // Perform compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    // Check results
    const allEvents = threadManager.getAllEvents(threadId);
    const workingEvents = threadManager.getEvents(threadId);

    expect(allEvents).toHaveLength(5); // Original 4 + 1 compaction event
    expect(workingEvents).toHaveLength(5); // Compacted conversation + compaction event

    // Verify detailed structure of working conversation after compaction
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'List files' })
    );
    expect(workingEvents[1]).toEqual(expect.objectContaining({ type: 'TOOL_CALL' }));
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
          isError: false,
        }) as unknown,
      })
    );
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({ type: 'AGENT_MESSAGE', data: { content: 'Found 5 files' } })
    );
    expect(workingEvents[4]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));
  });

  it('continues conversation after compaction', async () => {
    // Set up conversation and compact it
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello'));
    expectEventAdded(
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        id: 'call-hello',
        content: [{ type: 'text', text: 'line1\nline2\nline3\nline4\nline5' }],
        isError: false,
      })
    );

    await threadManager.compact(threadId, 'trim-tool-results');

    // Add more events after compaction
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'What next?'));
    expectEventAdded(threadManager.addEvent(threadId, 'AGENT_MESSAGE', { content: 'Let me help' }));

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    // Working conversation should include compacted events + compaction event + new events
    expect(workingEvents).toHaveLength(5); // 2 compacted + 1 compaction + 2 new

    // All events should include original + compaction event + new events
    expect(allEvents).toHaveLength(5); // 2 original + 1 compaction + 2 new = 5 total

    // Verify detailed structure of working conversation after adding more events
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Hello' })
    );
    expect(workingEvents[1]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-hello',
          content: [
            { type: 'text', text: 'line1\nline2\nline3\n[results truncated to save space.]' },
          ],
          isError: false,
        }) as unknown,
      })
    );
    expect(workingEvents[2]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'What next?' })
    );
    expect(workingEvents[4]).toEqual(
      expect.objectContaining({ type: 'AGENT_MESSAGE', data: { content: 'Let me help' } })
    );
  });

  it('handles multiple compactions', async () => {
    // Create initial conversation
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello'));
    expectEventAdded(
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        id: 'call-first',
        content: [{ type: 'text', text: 'long\nresult\nhere\nextra\nlines' }],
        isError: false,
      })
    );

    // First compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    // Add more events
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Continue'));
    expectEventAdded(
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        id: 'call-second',
        content: [{ type: 'text', text: 'another\nlong\nresult\nwith\nextra\nlines' }],
        isError: false,
      })
    );

    // Second compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    // Detailed verification of event structure
    const compactionEvents = allEvents.filter((e) => e.type === 'COMPACTION');
    expect(compactionEvents).toHaveLength(2);

    // All events should be exactly: [original1, original2, compaction1, more1, more2, compaction2]
    expect(allEvents).toHaveLength(6);
    expect(allEvents[0]).toEqual(expect.objectContaining({ type: 'USER_MESSAGE', data: 'Hello' }));
    expect(allEvents[1]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-first',
          content: [{ type: 'text', text: 'long\nresult\nhere\nextra\nlines' }],
          isError: false,
        }) as unknown,
      })
    );
    expect(allEvents[2]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));
    expect(allEvents[3]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Continue' })
    );
    expect(allEvents[4]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-second',
          content: [{ type: 'text', text: 'another\nlong\nresult\nwith\nextra\nlines' }],
          isError: false,
        }) as unknown,
      })
    );
    expect(allEvents[5]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));

    // Working events should contain: compacted events from latest compaction + latest compaction event
    expect(workingEvents).toHaveLength(5);

    // First 4 events should be the compacted conversation (original events with tool results trimmed, no old compaction)
    expect(workingEvents[0]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Hello' })
    );
    expect(workingEvents[1]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-first',
          content: [
            { type: 'text', text: 'long\nresult\nhere\n[results truncated to save space.]' },
          ],
          isError: false,
        }) as unknown,
      })
    );
    expect(workingEvents[2]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Continue' })
    );
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.objectContaining({
          id: 'call-second',
          content: [
            { type: 'text', text: 'another\nlong\nresult\n[results truncated to save space.]' },
          ],
          isError: false,
        }) as unknown,
      })
    );

    // Last event should be the latest compaction event
    expect(workingEvents[4]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));

    // Verify working conversation contains only the latest compaction, not the earlier one
    const workingCompactionEvents = workingEvents.filter((e) => e.type === 'COMPACTION');
    expect(workingCompactionEvents).toHaveLength(1);
    expect(workingCompactionEvents[0].id).toBe(allEvents[5].id); // Should be the second/latest compaction
  });

  it('throws error for unknown strategy', async () => {
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello'));

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
      newThreadManager.addEvent(newThreadId, 'TOOL_RESULT', {
        id: 'call-auto',
        content: [{ type: 'text', text: 'line1\nline2\nline3\nline4' }],
        isError: false,
      })
    );

    expect(async () => {
      await newThreadManager.compact(newThreadId, 'trim-tool-results');
    }).not.toThrow();
  });

  it('preserves event order in compacted conversation', async () => {
    // Add events in specific order
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'First message'));
    expectEventAdded(threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'First response'));
    expectEventAdded(
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        id: 'call-order',
        content: [{ type: 'text', text: 'long\ntool\nresult\nwith\nmany\nlines' }],
        isError: false,
      })
    );
    expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Second message'));

    await threadManager.compact(threadId, 'trim-tool-results');

    const workingEvents = threadManager.getEvents(threadId);

    // Check that order is preserved
    expect(workingEvents[0].type).toBe('USER_MESSAGE');
    expect(workingEvents[0].data).toBe('First message');
    expect(workingEvents[1].type).toBe('AGENT_MESSAGE');
    expect(workingEvents[1].data).toBe('First response');
    expect(workingEvents[2].type).toBe('TOOL_RESULT');
    expect((workingEvents[2].data as { content: Array<{ text: string }> }).content[0].text).toBe(
      'long\ntool\nresult\n[results truncated to save space.]'
    );
    expect(workingEvents[3].type).toBe('USER_MESSAGE');
    expect(workingEvents[3].data).toBe('Second message');
  });
});
