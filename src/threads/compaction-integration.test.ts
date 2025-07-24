import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';

describe('Compaction Integration', () => {
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    threadManager = new ThreadManager();
    threadId = threadManager.createThread();
  });

  it('creates working conversation without compaction', () => {
    // Add some events
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there');

    const workingEvents = threadManager.getEvents(threadId);
    const allEvents = threadManager.getAllEvents(threadId);

    expect(workingEvents).toHaveLength(2);
    expect(allEvents).toHaveLength(2);
    expect(workingEvents).toEqual(allEvents);
  });

  it('compacts conversation using trim-tool-results strategy', async () => {
    // Add events including a long tool result
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'List files');
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call1',
      name: 'list_files',
      arguments: {},
    });
    threadManager.addEvent(
      threadId,
      'TOOL_RESULT',
      'file1.txt\nfile2.txt\nfile3.txt\nfile4.txt\nfile5.txt'
    );
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Found 5 files');

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
        data: 'file1.txt\nfile2.txt\nfile3.txt\n[results truncated to save space.]',
      })
    );
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({ type: 'AGENT_MESSAGE', data: 'Found 5 files' })
    );
    expect(workingEvents[4]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));
  });

  it('continues conversation after compaction', async () => {
    // Set up conversation and compact it
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'line1\nline2\nline3\nline4\nline5');

    await threadManager.compact(threadId, 'trim-tool-results');

    // Add more events after compaction
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'What next?');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Let me help');

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
        data: 'line1\nline2\nline3\n[results truncated to save space.]',
      })
    );
    expect(workingEvents[2]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'What next?' })
    );
    expect(workingEvents[4]).toEqual(
      expect.objectContaining({ type: 'AGENT_MESSAGE', data: 'Let me help' })
    );
  });

  it('handles multiple compactions', async () => {
    // Create initial conversation
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'long\nresult\nhere\nextra\nlines');

    // First compaction
    await threadManager.compact(threadId, 'trim-tool-results');

    // Add more events
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Continue');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'another\nlong\nresult\nwith\nextra\nlines');

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
        data: expect.stringContaining('long\nresult\nhere') as string,
      })
    );
    expect(allEvents[2]).toEqual(expect.objectContaining({ type: 'COMPACTION' }));
    expect(allEvents[3]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Continue' })
    );
    expect(allEvents[4]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: expect.stringContaining('another\nlong\nresult') as string,
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
        data: 'long\nresult\nhere\n[results truncated to save space.]',
      })
    );
    expect(workingEvents[2]).toEqual(
      expect.objectContaining({ type: 'USER_MESSAGE', data: 'Continue' })
    );
    expect(workingEvents[3]).toEqual(
      expect.objectContaining({
        type: 'TOOL_RESULT',
        data: 'another\nlong\nresult\n[results truncated to save space.]',
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
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');

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
    newThreadManager.addEvent(newThreadId, 'TOOL_RESULT', 'line1\nline2\nline3\nline4');

    expect(async () => {
      await newThreadManager.compact(newThreadId, 'trim-tool-results');
    }).not.toThrow();
  });

  it('preserves event order in compacted conversation', async () => {
    // Add events in specific order
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'First message');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'First response');
    threadManager.addEvent(threadId, 'TOOL_RESULT', 'long\ntool\nresult\nwith\nmany\nlines');
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Second message');

    await threadManager.compact(threadId, 'trim-tool-results');

    const workingEvents = threadManager.getEvents(threadId);

    // Check that order is preserved
    expect(workingEvents[0].type).toBe('USER_MESSAGE');
    expect(workingEvents[0].data).toBe('First message');
    expect(workingEvents[1].type).toBe('AGENT_MESSAGE');
    expect(workingEvents[1].data).toBe('First response');
    expect(workingEvents[2].type).toBe('TOOL_RESULT');
    expect(workingEvents[2].data).toBe('long\ntool\nresult\n[results truncated to save space.]');
    expect(workingEvents[3].type).toBe('USER_MESSAGE');
    expect(workingEvents[3].data).toBe('Second message');
  });
});
