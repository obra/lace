// ABOUTME: Reminder row shape persisted in reminders.json and the in-memory
// ABOUTME: snapshot format consumed by ReminderStore + ReminderScheduler.

export type ReminderRecurs =
  | { kind: 'cron'; expr: string }
  | { kind: 'count'; interval_ms: number; remaining: number }
  | null;

export interface ReminderRow {
  /** `reminder_<12hex>`. */
  id: string;
  /** Epoch ms — surfaces as `set-at` attribute. */
  created_at: number;
  /** Epoch ms — when the next fire should happen. */
  next_fire_at: number;

  /** Past-me's words, stored raw (no XML escape until injection time). */
  prompt: string;

  /** null = one-shot; cron expr; or count-at-interval. */
  recurs: ReminderRecurs;

  /** Most recent successful fire (epoch ms), or null if never fired. */
  fired_at: number | null;
  /** Increments on every successful fire; 0 until the first fire. */
  fire_count: number;
}

export interface RemindersSnapshot {
  reminders: ReminderRow[];
}

/** Hard cap on pending+firing rows per session. */
export const MAX_ACTIVE_REMINDERS = 50;

/** Minimum interval for both cron evaluation and count-interval gap. */
export const MIN_INTERVAL_SECONDS = 300;
export const MIN_INTERVAL_MS = MIN_INTERVAL_SECONDS * 1000;
