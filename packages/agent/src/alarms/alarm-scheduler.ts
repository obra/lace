// ABOUTME: Single-loop per-process alarm scheduler for one session. Owns the in-memory
// ABOUTME: min-heap of pending alarms; sleeps until due or notify(); fires through the
// ABOUTME: injected notifier (which calls injectNotification in production).

import { computeNextCronFire } from './cron';
import type { AlarmStore } from './alarm-store';
import type { AlarmRow } from './types';

const BACKSTOP_POLL_MS = 5000;
const STALENESS_WINDOW_MS = 60_000;

export interface SchedulerNotifierArg {
  row: AlarmRow;
  firedAt: number;
}

export interface SchedulerDependencies {
  sessionDir: string;
  store: AlarmStore;
  now: () => number;
  jitterMaxMs: number;
  notifier: (arg: SchedulerNotifierArg) => void;
  /**
   * Called when a recurring alarm (cron or interval) passes its end_at.
   * Fires once per expiry, immediately before the row is deleted.
   */
  expiredNotifier?: (arg: SchedulerNotifierArg) => void;
  randomFn?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onError?: (err: unknown) => void;
}

interface HeapEntry {
  alarmId: string;
  next_fire_at: number;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms)
    );
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class AlarmScheduler {
  private readonly sessionDir: string;
  readonly store: AlarmStore;
  private readonly now: () => number;
  private readonly jitterMaxMs: number;
  private readonly notifier: (arg: SchedulerNotifierArg) => void;
  private readonly expiredNotifier: ((arg: SchedulerNotifierArg) => void) | undefined;
  private readonly onError: ((e: unknown) => void) | undefined;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly randomFn: () => number;

  private heap: HeapEntry[] = [];
  private running = false;
  private stopController: AbortController | null = null;
  private wakeResolve: (() => void) | null = null;
  private testNotifyHook: (() => void) | null = null;

  constructor(deps: SchedulerDependencies) {
    this.sessionDir = deps.sessionDir;
    this.store = deps.store;
    this.now = deps.now;
    this.jitterMaxMs = deps.jitterMaxMs;
    this.notifier = deps.notifier;
    this.expiredNotifier = deps.expiredNotifier;
    this.onError = deps.onError;
    this.sleep = deps.sleep ?? defaultSleep;
    this.randomFn = deps.randomFn ?? Math.random;
  }

  /** Read snapshot, demote firing→pending, run stale-recurring sweep, populate heap. */
  bootRecover(): void {
    this.store.repairFiringOnBoot();
    this.runStaleSweep();
    this.heap = this.store
      .listPending()
      .map((row) => ({ alarmId: row.id, next_fire_at: row.next_fire_at }));
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  enqueue(row: AlarmRow): void {
    this.heap.push({ alarmId: row.id, next_fire_at: row.next_fire_at });
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
    this.notify();
  }

  notify(): void {
    if (this.wakeResolve) {
      const r = this.wakeResolve;
      this.wakeResolve = null;
      r();
    }
    if (this.testNotifyHook) this.testNotifyHook();
  }

  onNotifyForTest(cb: () => void): void {
    this.testNotifyHook = cb;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.bootRecover();
    this.running = true;
    this.stopController = new AbortController();
    const signal = this.stopController.signal;
    try {
      while (!signal.aborted) {
        try {
          await this.tick(signal);
        } catch (err) {
          if (signal.aborted) break;
          this.onError?.(err);
          try {
            await this.sleep(BACKSTOP_POLL_MS, signal);
          } catch {
            break;
          }
        }
      }
    } finally {
      this.running = false;
      this.stopController = null;
      this.wakeResolve = null;
    }
  }

  async stop(): Promise<void> {
    this.stopController?.abort();
    this.notify();
  }

  async tickForTest(): Promise<void> {
    await this.tick(new AbortController().signal, { onceOnly: true });
  }

  private async tick(signal: AbortSignal, opts?: { onceOnly?: boolean }): Promise<void> {
    const soonest = this.heap[0];
    if (!soonest) {
      if (opts?.onceOnly) return;
      await this.sleepOrNotify(BACKSTOP_POLL_MS, signal);
      return;
    }
    const wait = soonest.next_fire_at - this.now();
    if (wait > 0) {
      if (opts?.onceOnly) return;
      await this.sleepOrNotify(Math.min(wait, BACKSTOP_POLL_MS), signal);
      return;
    }
    this.heap.shift();
    this.fire(soonest);
  }

  private fire(entry: HeapEntry): void {
    const row = this.store.get(entry.alarmId);
    if (!row) return;
    if (!this.store.claim(row.id)) return;
    const firedAt = this.now();
    try {
      this.notifier({ row, firedAt });
    } catch (err) {
      this.onError?.(err);
      // Fall through: still complete the state transition so the row exits 'firing'.
    }

    switch (row.kind) {
      case 'once':
        this.store.markFired(row.id, firedAt);
        return;
      case 'cron':
        this.handleCronReschedule(row, firedAt);
        return;
      case 'interval':
        this.handleIntervalReschedule(row, firedAt);
        return;
    }
  }

  private handleCronReschedule(row: AlarmRow, firedAt: number): void {
    try {
      if (row.spec.kind !== 'cron') return;
      const { jitteredMs } = computeNextCronFire({
        expr: row.spec.expr,
        timezone: row.timezone,
        after: new Date(firedAt),
        jitterMaxMs: this.jitterMaxMs,
        randomFn: this.randomFn,
      });
      if (row.end_at !== null && jitteredMs > row.end_at) {
        // Past end-of-life: emit expired notification, delete the row.
        this.emitExpired(row, firedAt);
        this.store.delete(row.id);
        return;
      }
      this.store.rescheduleCron(row.id, jitteredMs, firedAt);
      this.heap.push({ alarmId: row.id, next_fire_at: jitteredMs });
      this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
    } catch (err) {
      this.onError?.(err);
    }
  }

  private handleIntervalReschedule(row: AlarmRow, firedAt: number): void {
    if (row.spec.kind !== 'interval') return;
    const nextFireAt = firedAt + row.spec.minutes * 60_000;
    if (row.end_at !== null && nextFireAt > row.end_at) {
      this.emitExpired(row, firedAt);
      this.store.delete(row.id);
      return;
    }
    this.store.rescheduleInterval(row.id, nextFireAt, firedAt);
    this.heap.push({ alarmId: row.id, next_fire_at: nextFireAt });
    this.heap.sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  private emitExpired(row: AlarmRow, firedAt: number): void {
    if (!this.expiredNotifier) return;
    try {
      this.expiredNotifier({ row, firedAt });
    } catch (err) {
      this.onError?.(err);
    }
  }

  private runStaleSweep(): void {
    const cutoff = this.now() - STALENESS_WINDOW_MS;
    for (const row of this.store.staleRecurring(cutoff)) {
      try {
        if (row.spec.kind !== 'cron') continue;
        const { jitteredMs } = computeNextCronFire({
          expr: row.spec.expr,
          timezone: row.timezone,
          after: new Date(this.now()),
          jitterMaxMs: this.jitterMaxMs,
          randomFn: this.randomFn,
        });
        this.store.rescheduleStale(row.id, jitteredMs);
      } catch (err) {
        this.onError?.(err);
      }
    }
  }

  private async sleepOrNotify(ms: number, signal: AbortSignal): Promise<void> {
    let resolveWake: (() => void) | null = null;
    const notified = new Promise<void>((resolve) => {
      resolveWake = resolve;
      this.wakeResolve = resolve;
    });
    try {
      await Promise.race([this.sleep(ms, signal), notified]);
    } finally {
      if (this.wakeResolve === resolveWake) this.wakeResolve = null;
    }
  }
}
