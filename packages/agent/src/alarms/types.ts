// ABOUTME: Alarm row shape persisted in alarms.json and the in-memory snapshot
// ABOUTME: format consumed by AlarmStore + AlarmScheduler.

export type AlarmKind = 'once' | 'cron' | 'interval';

export type AlarmStatus = 'pending' | 'firing' | 'fired' | 'cancelled';
// Note: 'expired' is not a status — expired rows are DELETED from alarms.json.

/**
 * `spec` is the original user-facing input shape. The scheduler uses it
 * to (a) compute next_fire_at on reschedule, (b) drive the alarm-fired
 * body wording via the composer's discriminated input.
 */
export type AlarmSpec =
  | { kind: 'once-absolute'; iso: string }
  | { kind: 'once-relative'; minutes: number }
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; minutes: number };

export interface AlarmRow {
  id: string; // alarm_<12hex>
  kind: AlarmKind; // 'once' | 'cron' | 'interval'
  spec: AlarmSpec; // original input — drives presentation + reschedule
  timezone: string; // IANA — for cron + once-absolute formatting; UTC for once-relative + interval
  prompt: string;
  status: AlarmStatus;
  next_fire_at: number;
  created_at: number;
  fired_at: number | null;
  end_at: number | null; // epoch ms, for cron + interval. null = no end.
}

export interface AlarmsSnapshot {
  alarms: AlarmRow[];
}

export const MAX_ACTIVE_ALARMS = 50;
export const MIN_INTERVAL_MINUTES = 5;
