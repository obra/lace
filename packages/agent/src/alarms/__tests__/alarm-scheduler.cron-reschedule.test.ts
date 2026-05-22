// ABOUTME: Unit-level coverage that AlarmScheduler reschedules cron alarms onto
// ABOUTME: the heap after firing and refires when the next occurrence becomes due.
// ABOUTME: Lives at unit-level because the production min-interval check forbids
// ABOUTME: fast e2e cron tests (alternative path approved in PRI-1744 Task 23).

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AlarmScheduler } from '../alarm-scheduler';
import { AlarmStore } from '../alarm-store';

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-sched-cron-reschedule-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('AlarmScheduler cron reschedule', () => {
  it('fires a cron alarm, reschedules onto the heap, and fires again at the next occurrence', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);

    // Cron "0 9 * * *" — daily at 09:00 UTC.
    // Seed the first scheduled fire at 2030-01-01 09:00 UTC.
    const firstFire = Date.parse('2030-01-01T09:00:00Z');
    const row = store.insert({
      kind: 'cron',
      spec: { kind: 'cron', expr: '0 9 * * *' },
      timezone: 'UTC',
      prompt: 'morning ping',
      next_fire_at: firstFire,
      end_at: null,
      now: firstFire - 1_000,
    });

    // Mutable clock used by the scheduler under test.
    let nowMs = firstFire + 1; // just past the first scheduled occurrence
    const notify = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => nowMs,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: notify,
    });

    sched.bootRecover();

    // First tick — fires the first occurrence.
    await sched.tickForTest();
    expect(notify).toHaveBeenCalledTimes(1);

    // Cron rows go pending again with next_fire_at advanced one day.
    const afterFirst = store.get(row.id);
    expect(afterFirst?.status).toBe('pending');
    expect(afterFirst?.next_fire_at).toBe(Date.parse('2030-01-02T09:00:00Z'));

    // Advance clock past the next occurrence.
    nowMs = Date.parse('2030-01-02T09:00:00Z') + 1;

    // Second tick — fires the rescheduled occurrence.
    await sched.tickForTest();
    expect(notify).toHaveBeenCalledTimes(2);

    const afterSecond = store.get(row.id);
    expect(afterSecond?.status).toBe('pending');
    expect(afterSecond?.next_fire_at).toBe(Date.parse('2030-01-03T09:00:00Z'));
  });
});
