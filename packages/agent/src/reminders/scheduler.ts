// ABOUTME: ReminderScheduler — single-thread, per-session async-mutex scheduler.
// ABOUTME: Owns the in-memory min-heap and the wake timer. Fire path (§3.3 of spec)
// ABOUTME: is one atomic write per fire; cancel and schedule serialize via the mutex.

import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'node:crypto';
import { AsyncMutex } from './async-mutex';
import { ReminderStore } from './store';
import { computeNextCronFire, getAgentTimezone } from './cron';
import type { ReminderRecurs, ReminderRow } from './types';
import { MAX_ACTIVE_REMINDERS } from './types';
import { logger } from '@lace/agent/utils/logger';

/**
 * Count the number of cron matches in the half-open window (startMs, endMs].
 * The lower bound is exclusive because cron-parser's next() returns strictly
 * > currentDate, so a match at exactly startMs is not counted — that is the
 * persisted fire instant that was simply rescheduled, not a fire dropped
 * during downtime. The upper bound is inclusive because a match at exactly
 * endMs is counted (if (next > endMs) breaks only on strictly-greater values).
 * Capped at 1000 to prevent infinite loops on pathological expressions.
 */
function countCronMatchesInWindow(
  expr: string,
  tz: string,
  startMs: number,
  endMs: number
): number {
  if (startMs >= endMs) return 0;
  // Use startMs as the exclusive lower bound: next() returns strictly > currentDate,
  // so we count fires that occurred after the persisted next_fire_at, not the fire itself.
  const interval = CronExpressionParser.parse(expr, {
    tz,
    currentDate: new Date(startMs),
  });
  let count = 0;
  while (count < 1000) {
    let next: number;
    try {
      next = interval.next().toDate().getTime();
    } catch {
      break;
    }
    if (next > endMs) break;
    count++;
  }
  return count;
}

export interface FireContext {
  row: ReminderRow;
  /** Epoch ms — when this fire was committed (also the `fired-at` attribute value). */
  firedAt: number;
  /** 1-indexed: this is the Nth fire of this reminder. */
  fireCount: number;
  /** Previous successful fire, or null if this was the first. */
  lastFiredAt: number | null;
  /** Next scheduled fire after this one, or null if terminal. */
  nextFireAt: number | null;
}

export interface SchedulerDeps {
  sessionDir: string;
  now: () => number;
  notifier: (ctx: FireContext) => Promise<void> | void;
  onError?: (err: unknown) => void;
}

export interface ScheduleInput {
  prompt: string;
  /** seconds-from-now to first fire, or null for cron-driven. */
  delaySeconds: number | null;
  /** null for one-shot; cron string; or { kind:'count', interval_ms, remaining }. */
  recurs: ReminderRecurs;
}

export interface ScheduleResult {
  id: string;
  row: ReminderRow;
}

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: 'not_found' | 'persist_failed' };

interface HeapEntry {
  id: string;
  nextFireAt: number;
}

export class ReminderScheduler {
  // Public for the schedule/cancel/list handlers added in later tasks.
  readonly store: ReminderStore;
  readonly mutex = new AsyncMutex();

  private readonly now: () => number;
  private readonly notifier: SchedulerDeps['notifier'];
  private readonly onError: (err: unknown) => void;

  private heap: HeapEntry[] = [];
  private wakeTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SchedulerDeps) {
    this.store = new ReminderStore(deps.sessionDir);
    this.now = deps.now;
    this.notifier = deps.notifier;
    this.onError = deps.onError ?? (() => {});
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.bootRecover();
    this.rescheduleNextTick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  /** For tests: process all rows whose next_fire_at <= now, then return. */
  async tickForTest(now: number): Promise<void> {
    this.heap = this.store
      .list()
      .map((r) => ({ id: r.id, nextFireAt: r.next_fire_at }))
      .sort((a, b) => a.nextFireAt - b.nextFireAt);
    // Snapshot due IDs before processing to avoid re-firing entries that
    // the persist-failure path restores to the heap during this sweep.
    const due = this.heap.filter((e) => e.nextFireAt <= now).map((e) => e.id);
    this.heap = this.heap.filter((e) => e.nextFireAt > now);
    for (const id of due) {
      await this.fire(id);
    }
  }

  // ============================================================
  // Public action handlers — schedule / cancel / list.
  // ============================================================

  async schedule(input: ScheduleInput): Promise<ScheduleResult> {
    return this.mutex.runExclusive(async () => {
      const rows = this.store.list();
      if (rows.length >= MAX_ACTIVE_REMINDERS) {
        throw new Error(
          `Cannot schedule: ${rows.length} reminders are currently pending (over the ${MAX_ACTIVE_REMINDERS}-active cap). Call manage_reminders({action:"list"}) to see them and cancel ones you no longer need.`
        );
      }
      const id = `reminder_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const now = this.now();
      let nextFireAt: number;
      if (input.recurs && input.recurs.kind === 'cron') {
        const tz = getAgentTimezone();
        nextFireAt = computeNextCronFire(input.recurs.expr, tz, new Date(now));
      } else if (input.delaySeconds !== null) {
        nextFireAt = now + input.delaySeconds * 1000;
      } else {
        throw new Error('schedule requires `delaySeconds` or `recurs:cron`');
      }
      const newRow: ReminderRow = {
        id,
        created_at: now,
        next_fire_at: nextFireAt,
        prompt: input.prompt,
        recurs: input.recurs,
        fired_at: null,
        fire_count: 0,
      };
      this.store.save([...rows, newRow]);
      this.heap.push({ id, nextFireAt });
      this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
      this.rescheduleNextTick();
      return { id, row: newRow };
    });
  }

  async cancel(id: string): Promise<CancelResult> {
    return this.mutex.runExclusive(async () => {
      const rows = this.store.list();
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return { cancelled: false, reason: 'not_found' } as CancelResult;
      const nextRows = [...rows.slice(0, idx), ...rows.slice(idx + 1)];
      try {
        this.store.save(nextRows);
      } catch {
        return { cancelled: false, reason: 'persist_failed' } as CancelResult;
      }
      this.heap = this.heap.filter((e) => e.id !== id);
      this.rescheduleNextTick();
      return { cancelled: true } as CancelResult;
    });
  }

  /** Read-only; does NOT acquire the mutex (POSIX rename atomicity). */
  async list(): Promise<ReminderRow[]> {
    const rows = this.store.list();
    return [...rows].sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  // ============================================================
  // Internal — boot recovery and tick loop.
  // ============================================================

  private async bootRecover(): Promise<void> {
    // Refuse to start if TZ is unset (throws with /timezone is unset/ message).
    const tz = getAgentTimezone();

    const rows = this.store.list();
    const now = this.now();
    let mutated = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.recurs && row.recurs.kind === 'cron') {
        // Recompute next_fire_at against the current TZ.
        const newNext = computeNextCronFire(row.recurs.expr, tz, new Date(now));
        if (newNext !== row.next_fire_at) {
          // If the persisted time is meaningfully in the past, count fires dropped during downtime.
          if (row.next_fire_at < now - 60_000) {
            const dropped = countCronMatchesInWindow(
              row.recurs.expr,
              tz,
              row.next_fire_at,
              now
            );
            logger.warn('reminders.dropped_fires', {
              row_id: row.id,
              prompt: row.prompt,
              dropped_count: dropped,
            });
          }
          rows[i] = { ...row, next_fire_at: newNext };
          mutated = true;
        }
      } else if (row.recurs && row.recurs.kind === 'count') {
        // Shift schedule forward if the stored next_fire_at is stale (more than 1 min past).
        if (row.next_fire_at + 60_000 < now) {
          const newNext = now + row.recurs.interval_ms;
          logger.warn('reminders.schedule_shifted', {
            row_id: row.id,
            prompt: row.prompt,
            old_next_fire_at: row.next_fire_at,
            new_next_fire_at: newNext,
          });
          rows[i] = { ...row, next_fire_at: newNext };
          mutated = true;
        }
      }
    }

    // Write all recovery changes in a single atomic call.
    if (mutated) {
      try {
        this.store.save(rows);
      } catch (err) {
        // Spec §3.4 step 5: log and continue with in-memory state.
        logger.warn('reminders.recovery_persist_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.heap = rows
      .map((r) => ({ id: r.id, nextFireAt: r.next_fire_at }))
      .sort((a, b) => a.nextFireAt - b.nextFireAt);
  }

  private rescheduleNextTick(): void {
    if (!this.running) return;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    const head = this.heap[0];
    if (!head) return;
    const rawDelay = Math.max(0, head.nextFireAt - this.now());
    // setTimeout silently clamps delays > 2^31-1 to 1ms, which would create a
    // 1ms busy loop for reminders more than ~24.8 days out. Cap the delay so the
    // wake fires within the safe range; onTick re-arms if the row isn't due yet.
    const MAX_TIMEOUT_MS = 2_147_483_647 - 1;
    const delay = Math.min(rawDelay, MAX_TIMEOUT_MS);
    this.wakeTimer = setTimeout(() => {
      void this.onTick();
    }, delay);
  }

  private async onTick(): Promise<void> {
    if (!this.running) return;
    const head = this.heap[0];
    if (!head) return;
    if (head.nextFireAt > this.now()) {
      this.rescheduleNextTick();
      return;
    }
    this.heap.shift();
    await this.fire(head.id);
    this.rescheduleNextTick();
  }

  /**
   * Fire one row. Implements §3.3 of the spec under the mutex.
   *
   * Ordering guarantees:
   * 1. Compute post-fire state.
   * 2. Commit to disk. If commit fails: restore heap entry, call onError, skip notify.
   * 3. Update heap with next fire time (for recurring rows).
   * 4. Call notifier. If notifier throws: call onError (row already committed, at-most-one-missed).
   *
   * The try/finally ensures that if ANY exception escapes before disk commit
   * (e.g. an unexpected throw in computePostFire), the heap entry is restored
   * so a future tick can retry.
   */
  private async fire(id: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      let committed = false;
      try {
        const rows = this.store.list();
        const idx = rows.findIndex((r) => r.id === id);
        if (idx < 0) {
          committed = true; // Nothing to do; not an error.
          return;
        }

        const prior: ReminderRow = JSON.parse(JSON.stringify(rows[idx])) as ReminderRow;
        const firedAt = this.now();

        // Compute post-fire state.
        const post = this.computePostFire(prior, firedAt);
        // post.nextRow === null means delete.

        const nextRows = [...rows];
        if (post.nextRow === null) {
          nextRows.splice(idx, 1);
        } else {
          nextRows[idx] = post.nextRow;
        }

        // Commit to disk first. On failure: skip notify (heap restored in finally).
        try {
          this.store.save(nextRows);
        } catch (err) {
          this.onError(err);
          return; // committed stays false → heap restored in finally.
        }

        // Update heap for recurring rows (next fire entry).
        if (post.nextRow) {
          this.heap.push({ id, nextFireAt: post.nextRow.next_fire_at });
          this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
        }
        committed = true;

        // Notify after commit. Failure here is at-most-one-missed: row is already updated.
        try {
          await this.notifier({
            row: post.nextRow ?? prior,
            firedAt,
            fireCount: prior.fire_count + 1,
            lastFiredAt: prior.fired_at,
            nextFireAt: post.nextRow ? post.nextRow.next_fire_at : null,
          });
        } catch (err) {
          this.onError(err);
          // Row is already in post-fire state on disk — at-most-one-missed semantics.
        }
      } catch (err) {
        // Unexpected exception in computePostFire or elsewhere before disk commit.
        this.onError(err);
      } finally {
        if (!committed) {
          // Restore the heap entry so a future tick can retry.
          const row = this.store.list().find((r) => r.id === id);
          if (row) {
            this.heap.push({ id, nextFireAt: row.next_fire_at });
            this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
          }
        }
      }
    });
  }

  private computePostFire(
    prior: ReminderRow,
    firedAt: number
  ): { nextRow: ReminderRow | null } {
    if (prior.recurs === null) {
      // One-shot: delete after firing.
      return { nextRow: null };
    }

    if (prior.recurs.kind === 'count') {
      if (prior.recurs.remaining <= 1) {
        // Terminal fire: delete.
        return { nextRow: null };
      }
      // Continuing: reschedule with interval_ms from firedAt, decrement remaining.
      return {
        nextRow: {
          ...prior,
          next_fire_at: firedAt + prior.recurs.interval_ms,
          fired_at: firedAt,
          fire_count: prior.fire_count + 1,
          recurs: {
            kind: 'count',
            interval_ms: prior.recurs.interval_ms,
            remaining: prior.recurs.remaining - 1,
          },
        },
      };
    }

    // Cron: compute next match strictly > firedAt.
    // If computeNextCronFire throws (e.g. cron has no more matches in its
    // lookahead window), treat this as a terminal fire and delete the row.
    const tz = getAgentTimezone();
    try {
      const nextFireAt = computeNextCronFire(prior.recurs.expr, tz, new Date(firedAt));
      return {
        nextRow: {
          ...prior,
          next_fire_at: nextFireAt,
          fired_at: firedAt,
          fire_count: prior.fire_count + 1,
        },
      };
    } catch (err) {
      // Cron exhausted — treat as terminal fire so the row is deleted.
      this.onError(err);
      return { nextRow: null };
    }
  }
}
