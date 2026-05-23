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
import { logger } from '@lace/agent/utils/logger';

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

describe('ReminderScheduler boot recovery', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  afterEach(() => {
    process.env.TZ = origTZ;
  });

  it('refuses to start when TZ is unset', async () => {
    delete process.env.TZ;
    // Force Intl to also return empty to simulate stripped container; mock via stub.
    const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...origResolvedOptions.call(this), timeZone: '' } as Intl.ResolvedDateTimeFormatOptions;
    };
    try {
      const sched = new ReminderScheduler({
        sessionDir: tempSessionDir(),
        now: () => 0,
        notifier: async () => {},
      });
      await expect(sched.start()).rejects.toThrow(/timezone is unset/i);
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = origResolvedOptions;
    }
  });

  it('recomputes cron next_fire_at against current TZ on boot', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    // Persisted next_fire_at is stale (cron should fire at 9am UTC today, but persisted is yesterday).
    const yesterday = new Date('2026-05-21T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_aaaaaaaaaaaa',
        created_at: yesterday,
        next_fire_at: yesterday,
        prompt: 'daily',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
    ]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => new Date('2026-05-22T10:00:00Z').getTime(),
      notifier: async () => {},
    });
    await sched.start();
    await sched.stop();

    const rows = new ReminderStore(dir).list();
    expect(rows[0].next_fire_at).toBe(new Date('2026-05-23T09:00:00Z').getTime());
  });

  it('logs dropped_fires for cron when downtime skipped matches', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    // Persisted = 3 days ago; current = today. Cron is daily.
    const threeDaysAgo = new Date('2026-05-19T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_bbbbbbbbbbbb',
        created_at: threeDaysAgo,
        next_fire_at: threeDaysAgo,
        prompt: 'daily',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => new Date('2026-05-22T10:00:00Z').getTime(),
      notifier: async () => {},
    });
    await sched.start();
    await sched.stop();

    const calls = warnSpy.mock.calls.filter((c) => c[0] === 'reminders.dropped_fires');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ row_id: 'reminder_bbbbbbbbbbbb', dropped_count: 3 });
  });

  it('logs schedule_shifted for count-interval with stale next_fire_at', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    const stale = new Date('2026-05-22T08:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_cccccccccccc',
        created_at: stale,
        next_fire_at: stale,
        prompt: 'ping',
        recurs: { kind: 'count', interval_ms: 30 * 60_000, remaining: 5 },
        fired_at: null,
        fire_count: 0,
      },
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    const now = new Date('2026-05-22T10:00:00Z').getTime();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => now,
      notifier: async () => {},
    });
    await sched.start();
    await sched.stop();

    const rows = new ReminderStore(dir).list();
    expect(rows[0].next_fire_at).toBe(now + 30 * 60_000);
    // remaining is preserved.
    expect((rows[0].recurs as { kind: 'count'; remaining: number }).remaining).toBe(5);

    const calls = warnSpy.mock.calls.filter((c) => c[0] === 'reminders.schedule_shifted');
    expect(calls).toHaveLength(1);
  });

  it('on boot-recovery persist failure: continues with in-memory state and logs', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    const yesterday = new Date('2026-05-21T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_ffffffffffff',
        created_at: yesterday,
        next_fire_at: yesterday,
        prompt: 'daily',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
    ]);
    const warnSpy = vi.spyOn(logger, 'warn');

    const now = new Date('2026-05-22T10:00:00Z').getTime();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => now,
      notifier: async () => {},
    });
    // Force the recovery save to throw.
    const origSave = sched.store.save.bind(sched.store);
    let calls = 0;
    sched.store.save = ((rows: ReminderRow[]) => {
      calls++;
      if (calls === 1) throw new Error('disk full');
      return origSave(rows);
    }) as typeof origSave;

    await sched.start();
    await sched.stop();

    // On-disk row was unchanged (write failed).
    expect(new ReminderStore(dir).list()[0].next_fire_at).toBe(yesterday);
    // recovery_persist_failed was logged.
    const calls2 = warnSpy.mock.calls.filter((c) => c[0] === 'reminders.recovery_persist_failed');
    expect(calls2).toHaveLength(1);
  });

  it('persists all recovery changes in a single write', async () => {
    process.env.TZ = 'UTC';
    const dir = tempSessionDir();
    const threeDaysAgo = new Date('2026-05-19T09:00:00Z').getTime();
    new ReminderStore(dir).save([
      {
        id: 'reminder_dddddddddddd',
        created_at: threeDaysAgo,
        next_fire_at: threeDaysAgo,
        prompt: 'a',
        recurs: { kind: 'cron', expr: '0 9 * * *' },
        fired_at: null,
        fire_count: 0,
      },
      {
        id: 'reminder_eeeeeeeeeeee',
        created_at: threeDaysAgo,
        next_fire_at: threeDaysAgo,
        prompt: 'b',
        recurs: { kind: 'count', interval_ms: 30 * 60_000, remaining: 4 },
        fired_at: null,
        fire_count: 0,
      },
    ]);

    // Count writes by spying on the store's save method.
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => new Date('2026-05-22T10:00:00Z').getTime(),
      notifier: async () => {},
    });
    let saveCount = 0;
    const origSave = sched.store.save.bind(sched.store);
    sched.store.save = (rows) => {
      saveCount++;
      return origSave(rows);
    };

    await sched.start();
    await sched.stop();

    expect(saveCount).toBe(1);
  });
});
