// ABOUTME: schedule_alarm tool — first-class lace alarm scheduling. Writes to the
// ABOUTME: calling session's alarms.json and registers with the in-process scheduler.

import { z } from 'zod';
import { Tool } from '../tool';
import {
  assertValidCronMinInterval,
  assertValidIanaTimezone,
  computeNextCronFire,
  computeNextOnceFire,
} from '../../alarms/cron';
import { MAX_ACTIVE_ALARMS } from '../../alarms/types';
import { formatAbsoluteTime } from '../../notifications/format-time';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const scheduleSchema = z
  .object({
    kind: z.enum(['cron', 'once']),
    schedule: z.string().min(1),
    prompt: z.string().min(1),
    timezone: z.string().optional(),
  })
  .strict();

function errorResult(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}

function jsonResult(body: Record<string, unknown>): ToolResult {
  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify(body) }] };
}

export class ScheduleAlarmTool extends Tool {
  name = 'schedule_alarm';
  description =
    "Schedule an alarm that wakes you with a prompt at a future time. kind='cron' for recurring (e.g. '0 9 * * *', min interval 1 hour) or 'once' for an ISO-8601 timestamp in the future. timezone is an IANA name; required for cron. Up to 50 active alarms per session. Use list_alarms / cancel_alarm to manage. Alarms fire only while this lace process is alive.";
  schema = scheduleSchema;
  annotations: ToolAnnotations = {
    title: 'Schedule an alarm',
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof scheduleSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler, activeSessionId } = context;
    if (!alarmScheduler || !activeSessionId) {
      return errorResult('schedule_alarm requires alarmScheduler + activeSession in context');
    }

    const store = alarmScheduler.store;
    if (store.countActive() >= MAX_ACTIVE_ALARMS) {
      return errorResult(
        'Cannot schedule alarm: at the cap of 50 active alarms. Cancel one with cancel_alarm first.'
      );
    }

    const now = Date.now();
    const tz = args.timezone ?? 'UTC';
    let nextFireAt: number;
    try {
      if (args.kind === 'once') {
        if (args.timezone !== undefined) assertValidIanaTimezone(args.timezone);
        nextFireAt = computeNextOnceFire(args.schedule, now);
      } else {
        assertValidIanaTimezone(tz);
        assertValidCronMinInterval(args.schedule, tz);
        const { jitteredMs } = computeNextCronFire({
          expr: args.schedule,
          timezone: tz,
          after: new Date(now),
          jitterMaxMs: 0, // jitter applied at reschedule, not schedule
        });
        nextFireAt = jitteredMs;
      }
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const row = store.insert({
      kind: args.kind,
      schedule: args.schedule,
      timezone: tz,
      prompt: args.prompt,
      next_fire_at: nextFireAt,
      now,
    });
    alarmScheduler.enqueue(row);

    return jsonResult({
      id: row.id,
      kind: row.kind,
      schedule: row.schedule,
      prompt: row.prompt,
      timezone: row.timezone,
      next_fire_at_iso: formatAbsoluteTime(row.next_fire_at, row.timezone),
    });
  }
}
