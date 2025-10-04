// ABOUTME: Tests for event visibility persistence
// ABOUTME: Verifies visibleToModel field is persisted and read correctly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabasePersistence } from './database';
import type { LaceEvent } from '@lace/core/threads/types';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Event Visibility Persistence', () => {
  let tempDir: string;
  let dbPath: string;
  let db: DatabasePersistence;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    dbPath = join(tempDir, 'test.db');
    db = new DatabasePersistence(dbPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should persist visibleToModel: false correctly', () => {
    const threadId = 'lace_20251001_test01';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      visibleToModel: false,
      context: { threadId },
      timestamp: new Date(),
      id: 'evt_test01',
    };

    const saved = db.saveEvent(event);
    expect(saved).toBe(true);

    // Verify it persisted correctly
    const events = db.loadEvents(threadId);
    expect(events).toHaveLength(1);
    expect(events[0].visibleToModel).toBe(false);
  });

  it('should treat undefined visibleToModel as visible (not set in db)', () => {
    const threadId = 'lace_20251001_test02';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      context: { threadId },
      timestamp: new Date(),
      id: 'evt_test02',
    };

    const saved = db.saveEvent(event);
    expect(saved).toBe(true);

    const events = db.loadEvents(threadId);
    expect(events).toHaveLength(1);
    expect(events[0].visibleToModel).toBeUndefined();
  });

  it('should update event visibility from visible to not visible', () => {
    const threadId = 'lace_20251001_test03';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      context: { threadId },
      timestamp: new Date(),
      id: 'evt_test03',
    };

    db.saveEvent(event);

    // Update to not visible
    db.updateEventVisibility(event.id!, false);

    const events = db.loadEvents(threadId);
    expect(events[0].visibleToModel).toBe(false);
  });

  it('should update event visibility from not visible to visible', () => {
    const threadId = 'lace_20251001_test04';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const event: LaceEvent = {
      type: 'USER_MESSAGE',
      data: 'test message',
      visibleToModel: false,
      context: { threadId },
      timestamp: new Date(),
      id: 'evt_test04',
    };

    db.saveEvent(event);

    // Update to visible
    db.updateEventVisibility(event.id!, true);

    const events = db.loadEvents(threadId);
    expect(events[0].visibleToModel).toBeUndefined(); // NULL is treated as undefined
  });

  it('should handle multiple events with mixed visibility', () => {
    const threadId = 'lace_20251001_test05';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const events: LaceEvent[] = [
      {
        type: 'USER_MESSAGE',
        data: 'visible message 1',
        context: { threadId },
        timestamp: new Date(),
        id: 'evt_test05_1',
      },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'not visible message' },
        visibleToModel: false,
        context: { threadId },
        timestamp: new Date(),
        id: 'evt_test05_2',
      },
      {
        type: 'USER_MESSAGE',
        data: 'visible message 2',
        context: { threadId },
        timestamp: new Date(),
        id: 'evt_test05_3',
      },
    ];

    for (const event of events) {
      db.saveEvent(event);
    }

    const retrieved = db.loadEvents(threadId);
    expect(retrieved).toHaveLength(3);
    expect(retrieved[0].visibleToModel).toBeUndefined();
    expect(retrieved[1].visibleToModel).toBe(false);
    expect(retrieved[2].visibleToModel).toBeUndefined();
  });
});
