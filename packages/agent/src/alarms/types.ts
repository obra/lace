// ABOUTME: Alarm row shape persisted in alarms.json and the in-memory snapshot
// ABOUTME: format consumed by AlarmStore + AlarmScheduler.

export type AlarmKind = 'cron' | 'once';

export type AlarmStatus = 'pending' | 'firing' | 'fired' | 'cancelled';

export interface AlarmRow {
  id: string; // alarm_<12hex>
  kind: AlarmKind;
  schedule: string; // cron expr for cron, ISO-8601 for once
  timezone: string;
  prompt: string;
  status: AlarmStatus;
  next_fire_at: number; // epoch ms
  created_at: number; // epoch ms
  fired_at: number | null;
}

export interface AlarmsSnapshot {
  alarms: AlarmRow[];
}

export const MAX_ACTIVE_ALARMS = 50;
