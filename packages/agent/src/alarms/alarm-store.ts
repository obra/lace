// ABOUTME: Per-session AlarmStore. Single alarms.json snapshot, atomically rewritten
// ABOUTME: on every change via atomicWriteJson. In-memory Map mirrors the snapshot.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWriteJson } from '../storage/atomic-write';
import type { AlarmKind, AlarmRow, AlarmSpec, AlarmsSnapshot } from './types';
import { MAX_ACTIVE_ALARMS } from './types';
import { logger } from '@lace/agent/utils/logger';

export interface InsertAlarmArgs {
  kind: AlarmKind;
  spec: AlarmSpec;
  timezone: string;
  prompt: string;
  next_fire_at: number;
  end_at: number | null;
  now: number;
}

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: 'not_found' | 'already_fired' | 'already_cancelled' | 'firing' };

const FILE_NAME = 'alarms.json';

export class AlarmStore {
  private readonly path: string;
  private alarms = new Map<string, AlarmRow>();

  constructor(sessionDir: string) {
    mkdirSync(sessionDir, { recursive: true });
    this.path = join(sessionDir, FILE_NAME);
    this.load();
  }

  private load(): void {
    this.alarms.clear();
    if (!existsSync(this.path)) return;
    try {
      const snap = JSON.parse(readFileSync(this.path, 'utf8')) as AlarmsSnapshot;
      for (const row of snap.alarms) {
        if (typeof row.id !== 'string') continue;
        this.alarms.set(row.id, row);
      }
    } catch (err) {
      logger.warn('alarm.store.corrupt_snapshot', {
        path: this.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private persist(): void {
    const snap: AlarmsSnapshot = { alarms: [...this.alarms.values()] };
    atomicWriteJson(this.path, snap, { mode: 0o600 });
  }

  insert(args: InsertAlarmArgs): AlarmRow {
    const id = `alarm_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const row: AlarmRow = {
      id,
      kind: args.kind,
      spec: args.spec,
      timezone: args.timezone,
      prompt: args.prompt,
      status: 'pending',
      next_fire_at: args.next_fire_at,
      created_at: args.now,
      fired_at: null,
      end_at: args.end_at,
    };
    this.alarms.set(id, row);
    this.persist();
    return row;
  }

  get(id: string): AlarmRow | null {
    return this.alarms.get(id) ?? null;
  }

  claim(id: string): boolean {
    const row = this.alarms.get(id);
    if (!row || row.status !== 'pending') return false;
    this.alarms.set(id, { ...row, status: 'firing' });
    this.persist();
    return true;
  }

  markFired(id: string, firedAt: number): void {
    const row = this.alarms.get(id);
    if (!row) return;
    this.alarms.set(id, { ...row, status: 'fired', fired_at: firedAt });
    this.persist();
  }

  rescheduleCron(id: string, nextFireAt: number, firedAt: number): void {
    const row = this.alarms.get(id);
    if (!row) return;
    this.alarms.set(id, { ...row, status: 'pending', next_fire_at: nextFireAt, fired_at: firedAt });
    this.persist();
  }

  rescheduleInterval(id: string, nextFireAt: number, firedAt: number): void {
    const row = this.alarms.get(id);
    if (!row) return;
    this.alarms.set(id, { ...row, status: 'pending', next_fire_at: nextFireAt, fired_at: firedAt });
    this.persist();
  }

  rescheduleStale(id: string, nextFireAt: number): void {
    const row = this.alarms.get(id);
    if (!row || row.status !== 'pending' || row.kind !== 'cron') return;
    this.alarms.set(id, { ...row, next_fire_at: nextFireAt });
    this.persist();
  }

  /** Remove a row entirely (used on alarm expiry, after the expired notification fires). */
  delete(id: string): void {
    if (!this.alarms.has(id)) return;
    this.alarms.delete(id);
    this.persist();
  }

  cancel(id: string): CancelResult {
    const row = this.alarms.get(id);
    if (!row) return { cancelled: false, reason: 'not_found' };
    if (row.status === 'fired') return { cancelled: false, reason: 'already_fired' };
    if (row.status === 'cancelled') return { cancelled: false, reason: 'already_cancelled' };
    if (row.status === 'firing') return { cancelled: false, reason: 'firing' };
    this.alarms.set(id, { ...row, status: 'cancelled' });
    this.persist();
    return { cancelled: true };
  }

  listActive(): AlarmRow[] {
    return [...this.alarms.values()]
      .filter((r) => r.status === 'pending' || r.status === 'firing')
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  listPending(): AlarmRow[] {
    return [...this.alarms.values()]
      .filter((r) => r.status === 'pending')
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  countActive(): number {
    return this.listActive().length;
  }

  soonestPending(): AlarmRow | null {
    return this.listPending()[0] ?? null;
  }

  staleRecurring(cutoff: number): AlarmRow[] {
    return [...this.alarms.values()]
      .filter((r) => r.status === 'pending' && r.kind === 'cron' && r.next_fire_at < cutoff)
      .sort((a, b) => a.next_fire_at - b.next_fire_at);
  }

  /** On boot, any 'firing' row is interpreted as "crashed mid-fire" and demoted to pending. */
  repairFiringOnBoot(): void {
    let changed = false;
    for (const [id, row] of this.alarms) {
      if (row.status === 'firing') {
        this.alarms.set(id, { ...row, status: 'pending' });
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}

export { MAX_ACTIVE_ALARMS };
