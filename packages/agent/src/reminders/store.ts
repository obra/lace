// ABOUTME: Per-session ReminderStore. Single reminders.json snapshot, atomically
// ABOUTME: rewritten via atomicWriteJson. Pure load/save — no state machinery.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from '../storage/atomic-write';
import type { ReminderRow, RemindersSnapshot } from './types';
import { logger } from '@lace/agent/utils/logger';

const FILE_NAME = 'reminders.json';

/** reminders.json exists but isn't a {"reminders": [...]} snapshot of rows with string ids. */
export class ReminderStoreUnreadableError extends Error {
  constructor(
    readonly path: string,
    reason: string
  ) {
    super(`cannot read ${path}: ${reason}; leaving it untouched`);
    this.name = 'ReminderStoreUnreadableError';
  }
}

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

  /**
   * Read the snapshot for a read-modify-write. Unlike list(), a file that exists but is not a
   * {"reminders": [...]} snapshot of rows with string ids throws ReminderStoreUnreadableError,
   * because saving after a lenient read would replace every reminder in it.
   */
  listStrict(): ReminderRow[] {
    if (!existsSync(this.path)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (err) {
      throw new ReminderStoreUnreadableError(
        this.path,
        err instanceof Error ? err.message : String(err)
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ReminderStoreUnreadableError(this.path, 'not a {"reminders": [...]} object');
    }
    const rows = (parsed as { reminders?: unknown }).reminders;
    if (!Array.isArray(rows)) {
      throw new ReminderStoreUnreadableError(this.path, '"reminders" is missing or not an array');
    }
    for (const r of rows as unknown[]) {
      if (typeof r !== 'object' || r === null || typeof (r as { id?: unknown }).id !== 'string') {
        throw new ReminderStoreUnreadableError(this.path, 'a reminder has no string id');
      }
    }
    return rows as ReminderRow[];
  }

  /** Atomically rewrite reminders.json with the given rows. */
  save(rows: ReminderRow[]): void {
    const snapshot: RemindersSnapshot = { reminders: rows };
    atomicWriteJson(this.path, snapshot, { mode: 0o600 });
  }
}
