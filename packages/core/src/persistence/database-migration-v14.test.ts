// ABOUTME: Tests for database schema migration v14 (event visibility)
// ABOUTME: Verifies visible_to_model column is added and works correctly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabasePersistence } from '~/persistence/database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database Migration v14: Event Visibility', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should add visible_to_model column to events table', () => {
    const db = new DatabasePersistence(dbPath);

    // Create a thread and add an event
    const threadId = 'lace_20251001_test01';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const event = {
      type: 'USER_MESSAGE' as const,
      data: 'test message',
      context: { threadId },
      timestamp: new Date(),
      id: 'evt_test01',
    };

    db.saveEvent(event);

    // Query the event directly from database to check column exists
    const result = db
      .database!.prepare('SELECT visible_to_model FROM events WHERE thread_id = ?')
      .get(threadId) as { visible_to_model: number | null };

    // Should be NULL (treated as visible)
    expect(result.visible_to_model).toBeNull();
  });

  it('should allow setting visible_to_model to false', () => {
    const db = new DatabasePersistence(dbPath);

    const threadId = 'lace_20251001_test02';
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    const event = {
      type: 'USER_MESSAGE' as const,
      data: 'test message',
      context: { threadId },
      timestamp: new Date(),
      id: 'evt_test02',
    };

    db.saveEvent(event);

    // Update visible_to_model to false
    db.database!.prepare('UPDATE events SET visible_to_model = 0 WHERE id = ?').run(event.id);

    const result = db
      .database!.prepare('SELECT visible_to_model FROM events WHERE id = ?')
      .get(event.id) as { visible_to_model: number };

    expect(result.visible_to_model).toBe(0);
  });
});
