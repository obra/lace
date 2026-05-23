// ABOUTME: Per-session ReminderStore. Single reminders.json snapshot, atomically
// ABOUTME: rewritten via atomicWriteJson. Pure load/save — no state machinery.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from '../storage/atomic-write';
import type { ReminderRow, RemindersSnapshot } from './types';
import { logger } from '@lace/agent/utils/logger';

const FILE_NAME = 'reminders.json';

export class ReminderStore {
  private readonly path: string;

  constructor(private readonly sessionDir: string) {
    mkdirSync(sessionDir, { recursive: true });
    this.path = join(sessionDir, FILE_NAME);
  }

  /** Read the current snapshot. Returns [] on missing or malformed file. */
  list(): ReminderRow[] {
    if (!existsSync(this.path)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<RemindersSnapshot>;
      const rows = Array.isArray(raw.reminders) ? raw.reminders : [];
      return rows.filter((r): r is ReminderRow => typeof (r as ReminderRow)?.id === 'string');
    } catch (err) {
      logger.warn('reminders.store.corrupt_snapshot', {
        path: this.path,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /** Atomically rewrite reminders.json with the given rows. */
  save(rows: ReminderRow[]): void {
    const snapshot: RemindersSnapshot = { reminders: rows };
    atomicWriteJson(this.path, snapshot, { mode: 0o600 });
  }
}
