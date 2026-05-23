// ABOUTME: Tests for ReminderScheduler fire path (Task 5).
// ABOUTME: Covers one-shot delete, count-interval reschedule/terminal,
// ABOUTME: cron reschedule, notifier failure, and persist failure recovery.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderScheduler } from '../scheduler';
import { ReminderStore } from '../store';
import type { ReminderRow } from '../types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-rsched-'));
}

function makeRow(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 'reminder_aaaaaaaaaaaa',
    created_at: 1_700_000_000_000,
    next_fire_at: 1_700_000_000_500,
    prompt: 'fire me',
    recurs: null,
    fired_at: null,
    fire_count: 0,
    ...overrides,
  };
}

describe('ReminderScheduler fire path', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('fires a one-shot row, deletes it, and calls notifier with row + fire context', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({ next_fire_at: 1000 });
    store.save([row]);

    const fired: Array<{ row: ReminderRow; firedAt: number; fireCount: number }> = [];
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000, // past next_fire_at
      notifier: async (arg) => {
        fired.push(arg);
      },
      onError: () => {},
    });

    await sched.tickForTest(2000);

    expect(fired).toHaveLength(1);
    expect(fired[0].row.id).toBe(row.id);
    expect(fired[0].firedAt).toBe(2000);
    expect(fired[0].fireCount).toBe(1);

    // One-shot was deleted from disk.
    expect(new ReminderStore(dir).list()).toEqual([]);
  });

  it('reschedules a count-interval row after fire (continuing)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    store.save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: () => {},
    });

    await sched.tickForTest(2000);

    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].next_fire_at).toBe(2000 + 5 * 60_000);
    expect(rows[0].recurs).toEqual({ kind: 'count', interval_ms: 5 * 60_000, remaining: 2 });
    expect(rows[0].fire_count).toBe(1);
    expect(rows[0].fired_at).toBe(2000);
  });

  it('deletes count-interval row on terminal fire (remaining was 1)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 1 },
    });
    store.save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: () => {},
    });

    await sched.tickForTest(2000);
    expect(new ReminderStore(dir).list()).toEqual([]);
  });

  it('reschedules a cron row to the next match strictly > now', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    // 9am UTC daily.
    const baseTime = new Date('2026-05-22T09:00:00Z').getTime();
    const row = makeRow({
      next_fire_at: baseTime,
      recurs: { kind: 'cron', expr: '0 9 * * *' },
    });
    store.save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => baseTime + 100,
      notifier: async () => {},
      onError: () => {},
    });
    await sched.tickForTest(baseTime + 100);

    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].next_fire_at).toBe(new Date('2026-05-23T09:00:00Z').getTime());
  });

  it('on notifier failure, post-fire state is still committed (at-most-one-missed)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    store.save([row]);

    const errors: unknown[] = [];
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {
        throw new Error('inject failed');
      },
      onError: (err) => {
        errors.push(err);
      },
    });

    await sched.tickForTest(2000);

    // Row is already in post-fire state on disk even though notify failed.
    const rows = new ReminderStore(dir).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].fire_count).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('on persist failure during fire, restores heap entry and skips notify', async () => {
    const dir = tempSessionDir();
    const row = makeRow({
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    new ReminderStore(dir).save([row]);

    let notified = 0;
    let errors = 0;
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {
        notified++;
      },
      onError: () => {
        errors++;
      },
    });
    // Force store.save to throw once on next call.
    const realSave = sched.store.save.bind(sched.store);
    let calls = 0;
    sched.store.save = function (rows) {
      calls++;
      if (calls === 1) throw new Error('disk full');
      return realSave(rows);
    } as typeof realSave;

    await sched.tickForTest(2000);

    expect(notified).toBe(0);
    expect(errors).toBe(1);
    // Row unchanged on disk.
    const rows = new ReminderStore(dir).list();
    expect(rows[0].fire_count).toBe(0);
    expect(rows[0].next_fire_at).toBe(1000);
  });
});
