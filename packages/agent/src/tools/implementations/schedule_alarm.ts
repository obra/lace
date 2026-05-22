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
import type { AlarmSpec } from '../../alarms/types';
import { MAX_ACTIVE_ALARMS, MIN_INTERVAL_MINUTES } from '../../alarms/types';
import { formatAbsoluteTime } from '../../notifications/format-time';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const scheduleSchema = z
  .object({
    kind: z.enum(['once', 'cron', 'interval']),
    // For 'once': exactly one of schedule (ISO) | minutes (relative).
    // For 'cron': schedule = cron expression. For 'interval': use minutes.
    schedule: z.string().optional(),
    minutes: z.number().int().positive().optional(),
    timezone: z.string().optional(),
    endTime: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
    prompt: z.string().min(1),
  })
  .strict();

function errorResult(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}

function jsonResult(body: Record<string, unknown>): ToolResult {
  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify(body) }] };
}

interface ResolvedInputs {
  spec: AlarmSpec;
  timezone: string;
  nextFireAt: number;
  endAt: number | null;
}

/**
 * Translate the tool args into the persisted AlarmRow shape. Returns an error
 * string for any validation failure (each kind has different required/forbidden
 * fields). Side-effect-free.
 */
function resolveInputs(
  args: z.infer<typeof scheduleSchema>,
  now: number
): { ok: true; value: ResolvedInputs } | { ok: false; error: string } {
  if (args.kind === 'once') {
    if (args.endTime !== undefined || args.durationMinutes !== undefined) {
      return { ok: false, error: "kind='once' does not accept endTime or durationMinutes" };
    }
    const hasSchedule = args.schedule !== undefined;
    const hasMinutes = args.minutes !== undefined;
    if (hasSchedule && hasMinutes) {
      return {
        ok: false,
        error: "kind='once' accepts exactly one of schedule or minutes, not both",
      };
    }
    if (!hasSchedule && !hasMinutes) {
      return { ok: false, error: "kind='once' requires either schedule (ISO-8601) or minutes" };
    }
    if (hasSchedule) {
      if (args.timezone !== undefined) {
        try {
          assertValidIanaTimezone(args.timezone);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      let nextFireAt: number;
      try {
        nextFireAt = computeNextOnceFire(args.schedule as string, now);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return {
        ok: true,
        value: {
          spec: { kind: 'once-absolute', iso: args.schedule as string },
          timezone: args.timezone ?? 'UTC',
          nextFireAt,
          endAt: null,
        },
      };
    }
    // once + minutes (relative timer)
    const minutes = args.minutes as number;
    const nextFireAt = now + minutes * 60_000;
    return {
      ok: true,
      value: {
        spec: { kind: 'once-relative', minutes },
        timezone: 'UTC',
        nextFireAt,
        endAt: null,
      },
    };
  }

  if (args.kind === 'cron') {
    if (args.minutes !== undefined || args.durationMinutes !== undefined) {
      return { ok: false, error: "kind='cron' does not accept minutes or durationMinutes" };
    }
    if (args.schedule === undefined) {
      return { ok: false, error: "kind='cron' requires schedule (cron expression)" };
    }
    if (args.timezone === undefined) {
      return { ok: false, error: "kind='cron' requires timezone (IANA name)" };
    }
    const tz = args.timezone;
    try {
      assertValidIanaTimezone(tz);
      assertValidCronMinInterval(args.schedule, tz);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    let nextFireAt: number;
    try {
      const { jitteredMs } = computeNextCronFire({
        expr: args.schedule,
        timezone: tz,
        after: new Date(now),
        jitterMaxMs: 0, // jitter applied at reschedule, not schedule
      });
      nextFireAt = jitteredMs;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    let endAt: number | null = null;
    if (args.endTime !== undefined) {
      const parsed = Date.parse(args.endTime);
      if (Number.isNaN(parsed)) {
        return { ok: false, error: `invalid endTime ISO-8601 "${args.endTime}"` };
      }
      if (parsed <= now) {
        return { ok: false, error: `endTime ${args.endTime} is in the past` };
      }
      if (parsed <= nextFireAt) {
        return {
          ok: false,
          error: `endTime ${args.endTime} is at or before the first scheduled fire`,
        };
      }
      endAt = parsed;
    }
    return {
      ok: true,
      value: {
        spec: { kind: 'cron', expr: args.schedule },
        timezone: tz,
        nextFireAt,
        endAt,
      },
    };
  }

  // kind === 'interval'
  if (args.schedule !== undefined || args.timezone !== undefined) {
    return { ok: false, error: "kind='interval' does not accept schedule or timezone" };
  }
  if (args.minutes === undefined) {
    return { ok: false, error: "kind='interval' requires minutes" };
  }
  if (args.minutes < MIN_INTERVAL_MINUTES) {
    return {
      ok: false,
      error: `kind='interval' requires minutes >= ${MIN_INTERVAL_MINUTES} (got ${args.minutes})`,
    };
  }
  if (args.endTime !== undefined && args.durationMinutes !== undefined) {
    return {
      ok: false,
      error: "kind='interval' accepts at most one of endTime or durationMinutes",
    };
  }
  const nextFireAt = now + args.minutes * 60_000;
  let endAt: number | null = null;
  if (args.endTime !== undefined) {
    const parsed = Date.parse(args.endTime);
    if (Number.isNaN(parsed)) {
      return { ok: false, error: `invalid endTime ISO-8601 "${args.endTime}"` };
    }
    if (parsed <= now) {
      return { ok: false, error: `endTime ${args.endTime} is in the past` };
    }
    if (parsed <= nextFireAt) {
      return {
        ok: false,
        error: `endTime ${args.endTime} is at or before the first scheduled fire`,
      };
    }
    endAt = parsed;
  } else if (args.durationMinutes !== undefined) {
    endAt = now + args.durationMinutes * 60_000;
    if (endAt <= nextFireAt) {
      return {
        ok: false,
        error: `durationMinutes=${args.durationMinutes} ends at or before the first scheduled fire`,
      };
    }
  }
  return {
    ok: true,
    value: {
      spec: { kind: 'interval', minutes: args.minutes },
      timezone: 'UTC',
      nextFireAt,
      endAt,
    },
  };
}

export class ScheduleAlarmTool extends Tool {
  name = 'schedule_alarm';
  description =
    "Schedule an alarm that wakes you with a prompt at a future time. kind='once' fires once: provide schedule=ISO-8601 (absolute) or minutes=N (relative timer). kind='cron' is recurring (schedule=cron expr, e.g. '0 9 * * *', min interval 1 hour; timezone required as IANA name; optional endTime=ISO-8601). kind='interval' fires every minutes=N minutes (N>=5; optional durationMinutes or endTime). Up to 50 active alarms per session. Use list_alarms / cancel_alarm to manage. Alarms fire only while this lace process is alive.";
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
    const resolved = resolveInputs(args, now);
    if (!resolved.ok) {
      return await Promise.resolve(errorResult(resolved.error));
    }
    const { spec, timezone, nextFireAt, endAt } = resolved.value;

    const row = store.insert({
      kind: args.kind,
      spec,
      timezone,
      prompt: args.prompt,
      next_fire_at: nextFireAt,
      end_at: endAt,
      now,
    });
    alarmScheduler.enqueue(row);

    return jsonResult({
      id: row.id,
      kind: row.kind,
      spec: row.spec,
      prompt: row.prompt,
      timezone: row.timezone,
      next_fire_at_iso: formatAbsoluteTime(row.next_fire_at, row.timezone),
      end_at_iso: row.end_at !== null ? formatAbsoluteTime(row.end_at, row.timezone) : null,
    });
  }
}
