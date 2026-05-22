// ABOUTME: Unit tests for interval-kind alarms and end-of-life expiry for both
// ABOUTME: cron and interval alarms. Expired rows trigger expiredNotifier and are
// ABOUTME: removed from the store entirely (no 'expired' status).

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AlarmScheduler } from '../alarm-scheduler';
import { AlarmStore } from '../alarm-store';

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-sched-interval-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('AlarmScheduler interval', () => {
  it('fires an interval alarm and reschedules N minutes from firedAt', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    const firstFire = Date.parse('2030-01-01T00:00:00Z');
    const row = store.insert({
      kind: 'interval',
      spec: { kind: 'interval', minutes: 73 },
      timezone: 'UTC',
      prompt: 'ping the team',
      next_fire_at: firstFire,
      end_at: null,
      now: firstFire - 1_000,
    });

    const notify = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => firstFire + 1, // 1ms after the first fire
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: notify,
    });

    sched.bootRecover();
    await sched.tickForTest();
    expect(notify).toHaveBeenCalledTimes(1);

    const after = store.get(row.id);
    expect(after?.status).toBe('pending');
    // firedAt = now() = firstFire + 1 → next = firedAt + 73*60_000
    expect(after?.next_fire_at).toBe(firstFire + 1 + 73 * 60_000);
  });

  it('interval alarm expires when next fire would exceed end_at: fires expiredNotifier and deletes', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    const firstFire = Date.parse('2030-01-01T00:00:00Z');
    // end_at is before firstFire+10min, so next reschedule (firedAt + 10min) > end_at.
    const endAt = firstFire + 5 * 60_000;
    const row = store.insert({
      kind: 'interval',
      spec: { kind: 'interval', minutes: 10 },
      timezone: 'UTC',
      prompt: 'pings',
      next_fire_at: firstFire,
      end_at: endAt,
      now: firstFire - 1_000,
    });

    const notify = vi.fn();
    const expired = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => firstFire + 1,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: notify,
      expiredNotifier: expired,
    });

    sched.bootRecover();
    await sched.tickForTest();

    // The alarm fired once.
    expect(notify).toHaveBeenCalledTimes(1);
    // The expiredNotifier fired exactly once for the expired row.
    expect(expired).toHaveBeenCalledTimes(1);
    const arg = expired.mock.calls[0][0] as { row: { id: string } };
    expect(arg.row.id).toBe(row.id);
    // Row was deleted from the store.
    expect(store.get(row.id)).toBeNull();
    // Heap doesn't re-fire on next tick.
    await sched.tickForTest();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('cron alarm expires when next fire would exceed end_at', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    // Daily at 09:00 UTC, end_at on 2030-01-01 18:00 UTC — next fire (2030-01-02 09:00) > end_at.
    const firstFire = Date.parse('2030-01-01T09:00:00Z');
    const endAt = Date.parse('2030-01-01T18:00:00Z');
    const row = store.insert({
      kind: 'cron',
      spec: { kind: 'cron', expr: '0 9 * * *' },
      timezone: 'UTC',
      prompt: 'standup check',
      next_fire_at: firstFire,
      end_at: endAt,
      now: firstFire - 1_000,
    });

    const notify = vi.fn();
    const expired = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => firstFire + 1,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: notify,
      expiredNotifier: expired,
    });

    sched.bootRecover();
    await sched.tickForTest();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(store.get(row.id)).toBeNull();
  });

  it('cron alarm without end_at reschedules forever (no expired notification)', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    const firstFire = Date.parse('2030-01-01T09:00:00Z');
    store.insert({
      kind: 'cron',
      spec: { kind: 'cron', expr: '0 9 * * *' },
      timezone: 'UTC',
      prompt: 'forever',
      next_fire_at: firstFire,
      end_at: null,
      now: firstFire - 1_000,
    });

    const expired = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => firstFire + 1,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
      expiredNotifier: expired,
    });

    sched.bootRecover();
    await sched.tickForTest();
    expect(expired).not.toHaveBeenCalled();
    expect(store.listPending()).toHaveLength(1);
  });
});
