// ABOUTME: Unit tests for AlarmScheduler — fires due alarms, reschedules cron,
// ABOUTME: notify() wakes the loop, stale-recurring sweep on boot, calls injectNotification.

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AlarmScheduler } from '../alarm-scheduler';
import { AlarmStore } from '../alarm-store';

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-sched-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('AlarmScheduler', () => {
  it('fires due one-shot and calls notifier', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    store.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:01Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 100,
      now: 0,
    });
    const notify = vi.fn();
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => 1000,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: notify,
    });
    sched.bootRecover();
    await sched.tickForTest();
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0];
    expect(arg.row.id).toMatch(/^alarm_/);
    expect(store.get(arg.row.id)?.status).toBe('fired');
  });

  it('cron reschedules to next jittered occurrence', async () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    store.insert({
      kind: 'cron',
      schedule: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: Date.parse('2030-01-01T09:00:00Z'),
      now: 0,
    });
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => Date.parse('2030-01-01T09:00:01Z'),
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
    });
    sched.bootRecover();
    await sched.tickForTest();
    const pending = store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].next_fire_at).toBe(Date.parse('2030-01-02T09:00:00Z'));
  });

  it('notify wakes the loop', () => {
    const sessionDir = setupDir();
    const sched = new AlarmScheduler({
      sessionDir,
      store: new AlarmStore(sessionDir),
      now: () => 0,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
    });
    const woken = vi.fn();
    sched.onNotifyForTest(woken);
    sched.notify();
    expect(woken).toHaveBeenCalled();
  });

  it('boot repairs firing → pending', () => {
    const sessionDir = setupDir();
    const store = new AlarmStore(sessionDir);
    const row = store.insert({
      kind: 'once',
      schedule: '2030-01-01T00:00:00Z',
      timezone: 'UTC',
      prompt: 'p',
      next_fire_at: 1,
      now: 0,
    });
    store.claim(row.id);
    const sched = new AlarmScheduler({
      sessionDir,
      store,
      now: () => 0,
      jitterMaxMs: 0,
      randomFn: () => 0,
      notifier: vi.fn(),
    });
    sched.bootRecover();
    expect(store.get(row.id)?.status).toBe('pending');
  });
});
