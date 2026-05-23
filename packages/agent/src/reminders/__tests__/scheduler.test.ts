// ABOUTME: Tests for ReminderScheduler fire path (Task 5).
// ABOUTME: Covers one-shot delete, count-interval reschedule/terminal,
// ABOUTME: cron reschedule, notifier failure, and persist failure recovery.
// ABOUTME: Also covers schedule/cancel/list APIs (Task 7).

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

    // Heap entry was restored — direct inspection proves the finally block ran.
    // Previously this test only checked disk state, meaning a silent heap-restore
    // skip would not be caught. tickForTest rebuilds from disk each call so it
    // cannot distinguish a restored heap from a rebuilt one.
    const heapState = (sched as unknown as { heap: Array<{ id: string }> }).heap;
    expect(heapState.find((e) => e.id === row.id)).toBeDefined();
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

describe('ReminderScheduler schedule', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('persists a one-shot row, returns id and next_fire_at', async () => {
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 1_700_000_000_000,
      notifier: async () => {},
    });
    await sched.start();

    const result = await sched.schedule({
      prompt: 'follow up',
      delaySeconds: 300,
      recurs: null,
    });

    expect(result.id).toMatch(/^reminder_[0-9a-f]{12}$/);
    expect(result.row.next_fire_at).toBe(1_700_000_000_000 + 300_000);
    expect(result.row.recurs).toBe(null);
    expect(new ReminderStore(dir).list()).toHaveLength(1);

    await sched.stop();
  });

  it('persists a cron row, computes initial next_fire_at', async () => {
    process.env.TZ = 'UTC';
    const now = new Date('2026-05-22T08:00:00Z').getTime();
    const dir = tempSessionDir();
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => now,
      notifier: async () => {},
    });
    await sched.start();

    const result = await sched.schedule({
      prompt: 'daily',
      delaySeconds: null,
      recurs: { kind: 'cron', expr: '0 9 * * *' },
    });

    expect(result.row.next_fire_at).toBe(new Date('2026-05-22T09:00:00Z').getTime());
    await sched.stop();
  });

  it('rejects schedule when over the 50-cap', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const rows: ReminderRow[] = [];
    for (let i = 0; i < 50; i++) {
      rows.push({
        id: `reminder_${i.toString(16).padStart(12, '0')}`,
        created_at: 0,
        next_fire_at: 10_000_000_000 + i,
        prompt: 'p',
        recurs: null,
        fired_at: null,
        fire_count: 0,
      });
    }
    store.save(rows);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    await expect(
      sched.schedule({ prompt: 'one more', delaySeconds: 300, recurs: null })
    ).rejects.toThrow(/over the 50-active cap/i);
    await sched.stop();
  });
});

describe('ReminderScheduler cancel', () => {
  beforeEach(() => { process.env.TZ = 'UTC'; });

  it('deletes a pending row and returns cancelled:true', async () => {
    const dir = tempSessionDir();
    const row = makeRow({ id: 'reminder_111111111111', next_fire_at: 10_000_000_000 });
    new ReminderStore(dir).save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();

    const result = await sched.cancel('reminder_111111111111');
    expect(result).toEqual({ cancelled: true });
    expect(new ReminderStore(dir).list()).toEqual([]);
    await sched.stop();
  });

  it('returns not_found for unknown ids', async () => {
    const sched = new ReminderScheduler({
      sessionDir: tempSessionDir(),
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const result = await sched.cancel('reminder_does_not_exist');
    expect(result).toEqual({ cancelled: false, reason: 'not_found' });
    await sched.stop();
  });

  it('returns persist_failed when store.save throws; heap and disk unchanged', async () => {
    const dir = tempSessionDir();
    const row = makeRow({ id: 'reminder_777777777777', next_fire_at: 10_000_000_000 });
    new ReminderStore(dir).save([row]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();

    // Force save to throw on next call.
    const origSave = sched.store.save.bind(sched.store);
    let calls = 0;
    sched.store.save = ((rows: ReminderRow[]) => {
      calls++;
      if (calls === 1) throw new Error('disk full');
      return origSave(rows);
    }) as typeof origSave;

    const result = await sched.cancel('reminder_777777777777');
    expect(result).toEqual({ cancelled: false, reason: 'persist_failed', retry_safe: true });

    // Disk row still present (write failed).
    expect(new ReminderStore(dir).list()).toHaveLength(1);
    expect(new ReminderStore(dir).list()[0].id).toBe('reminder_777777777777');

    await sched.stop();
  });
});

describe('ReminderScheduler list', () => {
  beforeEach(() => { process.env.TZ = 'UTC'; });

  it('returns all current rows sorted by next_fire_at ascending', async () => {
    const dir = tempSessionDir();
    new ReminderStore(dir).save([
      makeRow({ id: 'reminder_222222222222', next_fire_at: 2000 }),
      makeRow({ id: 'reminder_111111111111', next_fire_at: 1000 }),
      makeRow({ id: 'reminder_333333333333', next_fire_at: 3000 }),
    ]);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    await sched.start();
    const rows = await sched.list();
    expect(rows.map((r) => r.id)).toEqual([
      'reminder_111111111111',
      'reminder_222222222222',
      'reminder_333333333333',
    ]);
    await sched.stop();
  });
});

describe('ReminderScheduler far-future timer', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('does not emit TimeoutOverflowWarning for reminders >24.8 days out', async () => {
    const dir = tempSessionDir();
    const row = makeRow({
      id: 'reminder_cccccccccccc',
      // 100 days in the future from frozen clock — well past the 2^31-1 ms boundary.
      next_fire_at: 100 * 24 * 60 * 60 * 1000, // 100 days in ms
    });
    new ReminderStore(dir).save([row]);

    // Capture process warnings during start. Node emits TimeoutOverflowWarning
    // when setTimeout receives a value > 2^31-1.
    const warnings: string[] = [];
    const warningListener = (warning: Error): void => {
      warnings.push(warning.name);
    };
    process.on('warning', warningListener);

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 0,
      notifier: async () => {},
    });
    try {
      await sched.start();
      // Yield a few microtasks to let any setTimeout fire.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    } finally {
      await sched.stop();
      process.off('warning', warningListener);
    }

    expect(warnings.filter((w) => w === 'TimeoutOverflowWarning')).toEqual([]);
  });
});

describe('ReminderScheduler exception handling', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('cron exhaustion onError includes the row id', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row: ReminderRow = {
      id: 'reminder_ffffffffffff',
      created_at: 0,
      next_fire_at: 1000,
      prompt: 'p',
      recurs: { kind: 'cron', expr: '0 9 29 2 *' },
      fired_at: null,
      fire_count: 0,
    };
    store.save([row]);

    const errors: unknown[] = [];
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: (err) => { errors.push(err); },
    });

    const cronMod = await import('../cron');
    const spy = vi.spyOn(cronMod, 'computeNextCronFire').mockImplementation(() => {
      throw new Error('cron exhausted');
    });

    await sched.tickForTest(2000);

    expect(errors).toHaveLength(1);
    const err = errors[0];
    // The error should carry the row id in the message.
    const repr = err instanceof Error ? err.message : JSON.stringify(err);
    expect(repr).toContain('reminder_ffffffffffff');

    spy.mockRestore();
  });

  it('treats exhausted cron as terminal fire (no zombie row)', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row: ReminderRow = {
      id: 'reminder_aaaaaaaaaaaa',
      created_at: 0,
      next_fire_at: 1000,
      prompt: 'p',
      recurs: { kind: 'cron', expr: '0 9 29 2 *' }, // valid cron, only leap years
      fired_at: null,
      fire_count: 0,
    };
    store.save([row]);

    let notified = 0;
    let errors = 0;
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => { notified++; },
      onError: () => { errors++; },
    });

    // Monkey-patch computeNextCronFire to throw, simulating an exhausted cron.
    const cronMod = await import('../cron');
    const spy = vi.spyOn(cronMod, 'computeNextCronFire').mockImplementation(() => {
      throw new Error('cron exhausted');
    });

    await sched.tickForTest(2000);

    // Expected: row deleted (terminal semantics on cron exhaustion).
    expect(store.list()).toEqual([]);
    // Notifier was called (the fire still happens; it's just terminal).
    expect(notified).toBe(1);
    // onError called for observability.
    expect(errors).toBe(1);

    spy.mockRestore();
  });

  it('restores heap entry if computePostFire throws unexpectedly', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row: ReminderRow = {
      id: 'reminder_bbbbbbbbbbbb',
      created_at: 0,
      next_fire_at: 1000,
      prompt: 'p',
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
      fired_at: null,
      fire_count: 0,
    };
    store.save([row]);

    let errors = 0;
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: () => { errors++; },
    });

    // Monkey-patch the scheduler's computePostFire to throw, simulating an
    // unexpected exception. The heap restore in fire() must catch it.
    type FireScheduler = ReminderScheduler & { computePostFire: (...args: unknown[]) => unknown };
    const ps = sched as unknown as FireScheduler;
    const orig = ps.computePostFire.bind(ps);
    let calls = 0;
    ps.computePostFire = (...args: unknown[]) => {
      calls++;
      if (calls === 1) throw new Error('unexpected');
      return orig(...args);
    };

    await sched.tickForTest(2000);

    // Row unchanged on disk (no commit happened).
    const rows = store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].fire_count).toBe(0);
    expect(rows[0].next_fire_at).toBe(1000);

    // onError was called.
    expect(errors).toBe(1);

    // Heap entry was restored — direct inspection (independent of tickForTest's rebuild).
    const heapState = (sched as unknown as { heap: Array<{ id: string }> }).heap;
    expect(heapState.find((e) => e.id === row.id)).toBeDefined();
  });

  it('restores heap entry via prior snapshot even if store.list() fails during finally', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      id: 'reminder_eeeeeeeeeeee',
      next_fire_at: 1000,
      recurs: { kind: 'count', interval_ms: 5 * 60_000, remaining: 3 },
    });
    store.save([row]);

    let errors = 0;
    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {},
      onError: () => { errors++; },
    });

    // Force store.save to throw on the first call (fire's persist attempt).
    // Also force store.list to throw on its second call (which would be the
    // finally block re-reading disk in the pre-fix code path).
    const origSave = sched.store.save.bind(sched.store);
    const origList = sched.store.list.bind(sched.store);
    let saveCalls = 0;
    let listCalls = 0;
    sched.store.save = ((rows: ReminderRow[]) => {
      saveCalls++;
      if (saveCalls === 1) throw new Error('disk full');
      return origSave(rows);
    }) as typeof origSave;
    sched.store.list = (() => {
      listCalls++;
      // list() call order inside a single tick:
      //   call 1: tickForTest rebuilds heap
      //   call 2: fire() reads rows at top of try block
      //   call 3: pre-fix finally block re-reads disk for heap restore
      // Post-fix, the finally block uses `prior` instead of list(), so call 3
      // never happens — and heap restore works even if list() would throw here.
      if (listCalls === 3) throw new Error('disk failure during restore');
      return origList();
    }) as typeof origList;

    await sched.tickForTest(2000);

    // At minimum the save-failure onError should have fired.
    expect(errors).toBeGreaterThanOrEqual(1);

    // Heap entry must be restored despite list() throwing on second call.
    const heapState = (sched as unknown as { heap: Array<{ id: string }> }).heap;
    expect(heapState.find((e) => e.id === row.id)).toBeDefined();

    // Restore patched methods and verify the row fires successfully on next tick.
    sched.store.save = origSave;
    sched.store.list = origList;
    const fired: number[] = [];
    (sched as unknown as { notifier: (ctx: { firedAt: number }) => Promise<void> }).notifier =
      async (ctx: { firedAt: number }) => { fired.push(ctx.firedAt); };

    await sched.tickForTest(3000);
    expect(fired).toHaveLength(1);
  });
});

describe('ReminderScheduler.stop drains in-flight fire', () => {
  const origTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'UTC'; });
  afterEach(() => { process.env.TZ = origTZ; });

  it('does not return until any in-flight fire has committed to disk', async () => {
    const dir = tempSessionDir();
    const store = new ReminderStore(dir);
    const row = makeRow({
      id: 'reminder_dddddddddddd',
      next_fire_at: 1000,
      recurs: null, // one-shot
    });
    store.save([row]);

    // notifier blocks until we resolve the gate, simulating a slow inject.
    let resolveNotify: () => void;
    const notifyGate = new Promise<void>((r) => { resolveNotify = r; });
    let notifyCallCount = 0;

    const sched = new ReminderScheduler({
      sessionDir: dir,
      now: () => 2000,
      notifier: async () => {
        notifyCallCount++;
        await notifyGate; // hold the fire path inside the mutex
      },
    });

    // Manually trigger a fire path by directly calling tickForTest in the
    // background — DON'T await it yet. This simulates the scheduler being
    // mid-fire when stop() is called.
    await sched.start();
    // We can't directly hook into the scheduler's running fire path without
    // making fire() public. Use tickForTest as a proxy: it acquires the same
    // mutex via fire() and notifier blocks inside it.
    const firePromise = sched.tickForTest(2000);

    // Give the scheduler a microtask to enter the notifier.
    await new Promise((r) => setImmediate(r));
    expect(notifyCallCount).toBe(1); // notifier is now blocked inside mutex

    // Call stop. It MUST not resolve until the notifier resolves.
    let stopResolved = false;
    const stopPromise = sched.stop().then(() => { stopResolved = true; });

    // Yield a few microtasks; stop should still be pending because mutex held.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(stopResolved).toBe(false);

    // Release the notifier; the fire path commits, then stop resolves.
    resolveNotify!();
    await firePromise;
    await stopPromise;
    expect(stopResolved).toBe(true);

    // Disk reflects post-fire state (one-shot was deleted).
    expect(new ReminderStore(dir).list()).toEqual([]);
  });
});
