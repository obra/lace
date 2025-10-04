// ABOUTME: Tests for compaction visibility updates
// ABOUTME: Verifies events are marked as not visible during compaction

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from './thread-manager';
import type { LaceEvent } from './types';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Compaction Visibility', () => {
  let tempDir: string;
  let manager: ThreadManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    process.env.LACE_DIR = tempDir;
    manager = new ThreadManager();
  });

  afterEach(() => {
    delete process.env.LACE_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should mark pre-compaction events as not visible', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    // Add some events
    const event1 = manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'First message',
      context: { threadId },
    } as LaceEvent);

    const event2 = manager.addEvent({
      type: 'AGENT_MESSAGE',
      data: { content: 'First response' },
      context: { threadId },
    } as LaceEvent);

    const event3 = manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Second message',
      context: { threadId },
    } as LaceEvent);

    // Verify all start as visible
    expect(event1!.visibleToModel).toBeUndefined();
    expect(event2!.visibleToModel).toBeUndefined();
    expect(event3!.visibleToModel).toBeUndefined();

    // Compact using trim strategy (doesn't need AI)
    const result = await manager.compact(threadId, 'trim-tool-results');

    // All pre-compaction events should be hidden
    expect(result.hiddenEventIds).toContain(event1!.id);
    expect(result.hiddenEventIds).toContain(event2!.id);
    expect(result.hiddenEventIds).toContain(event3!.id);

    // COMPACTION event itself should be hidden
    expect(result.hiddenEventIds).toContain(result.compactionEvent.id);

    // Verify by reading from database
    const thread = manager.getThread(threadId);
    const event1Updated = thread!.events.find((e) => e.id === event1!.id);
    expect(event1Updated!.visibleToModel).toBe(false);
  });

  it('should keep post-compaction events visible', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    // Add events before compaction
    manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Before compaction',
      context: { threadId },
    } as LaceEvent);

    // Compact
    const result = await manager.compact(threadId, 'trim-tool-results');

    // Add event after compaction
    const postEvent = manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'After compaction',
      context: { threadId },
    } as LaceEvent);

    // Post-compaction event should be visible
    expect(postEvent!.visibleToModel).toBeUndefined();
    expect(result.hiddenEventIds).not.toContain(postEvent!.id);
  });

  it('should handle second compaction correctly', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    // First batch of events
    const event1 = manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'First batch',
      context: { threadId },
    } as LaceEvent);

    // First compaction
    const result1 = await manager.compact(threadId, 'trim-tool-results');
    expect(result1.hiddenEventIds).toContain(event1!.id);

    // Second batch of events (including compacted replacement from first compaction)
    const event2 = manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Second batch',
      context: { threadId },
    } as LaceEvent);

    // Second compaction
    const result2 = await manager.compact(threadId, 'trim-tool-results');

    // First batch should still be hidden
    const thread = manager.getThread(threadId);
    const event1Updated = thread!.events.find((e) => e.id === event1!.id);
    expect(event1Updated!.visibleToModel).toBe(false);

    // First compaction event should still be hidden
    const firstCompaction = thread!.events.find((e) => e.id === result1.compactionEvent.id);
    expect(firstCompaction!.visibleToModel).toBe(false);

    // Second batch should now be hidden
    expect(result2.hiddenEventIds).toContain(event2!.id);

    // Second compaction event should be hidden
    expect(result2.hiddenEventIds).toContain(result2.compactionEvent.id);
  });

  it('should persist compacted events as separate database rows', async () => {
    const threadId = manager.generateThreadId();
    manager.createThread(threadId);

    const originalEvent = manager.addEvent({
      type: 'USER_MESSAGE',
      data: 'Original message',
      context: { threadId },
    } as LaceEvent);

    // Use trim strategy which creates replacement events
    const result = await manager.compact(threadId, 'trim-tool-results');
    const compactionData = result.compactionEvent.data as any;

    // Compacted events should NOT be in COMPACTION data (they're separate rows now)
    expect(compactionData.compactedEvents).toBeUndefined();
    expect(compactionData.compactedEventCount).toBeGreaterThan(0);

    // Original event should be marked as not visible
    const thread = manager.getThread(threadId);
    const originalInThread = thread!.events.find((e) => e.id === originalEvent!.id);
    expect(originalInThread!.visibleToModel).toBe(false);

    // Compacted replacement events should exist as separate database rows with visibleToModel !== false
    const visibleEvents = thread!.events.filter((e) => e.visibleToModel !== false);
    expect(visibleEvents.length).toBeGreaterThan(0);

    // Find the compacted version of the user message
    const compactedUserMessage = visibleEvents.find(
      (e) => e.type === 'USER_MESSAGE' && e.data === 'Original message'
    );
    expect(compactedUserMessage).toBeDefined();
    expect(compactedUserMessage!.visibleToModel).not.toBe(false);
  });
});
