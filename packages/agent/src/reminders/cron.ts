// ABOUTME: Cron + agent-localtime helpers for the reminders subsystem.
// ABOUTME: Cron uses process.env.TZ / Intl fallback (no agent-supplied tz).
// ABOUTME: 5-min floor enforced over the next 20 matches to catch irregular patterns.

import { CronExpressionParser } from 'cron-parser';
import { MIN_INTERVAL_MS } from './types';

const SAMPLE_COUNT = 20;

/** Returns the agent's localtime IANA name from process.env.TZ or Intl. */
export function getAgentTimezone(): string {
  const envTZ = process.env.TZ;
  if (envTZ && envTZ.trim().length > 0) return envTZ;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && tz.length > 0) return tz;
  throw new Error(
    'agent timezone is unset: set process.env.TZ to an IANA name (e.g. America/Los_Angeles)'
  );
}

/** Next match strictly > `after`. */
export function computeNextCronFire(expr: string, timezone: string, after: Date): number {
  const interval = CronExpressionParser.parse(expr, {
    tz: timezone,
    currentDate: after, // cron-parser's `next()` returns strictly > currentDate.
  });
  return interval.next().toDate().getTime();
}

/**
 * Validate that the cron expression's minimum inter-fire delta across the
 * next 20 fires is at least 5 minutes. The 20-sample window catches
 * irregular patterns like `0,1 9 * * *` (1-min cluster gap) that a
 * 2-sample check would miss.
 */
export function assertCronAtLeast5MinInterval(expr: string, timezone: string): void {
  let interval: ReturnType<typeof CronExpressionParser.parse>;
  try {
    interval = CronExpressionParser.parse(expr, { tz: timezone });
  } catch (err) {
    throw new Error(
      `invalid cron expression "${expr}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let previous: number | null = null;
  let minDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    let next: number;
    try {
      next = interval.next().toDate().getTime();
    } catch {
      // Cron has no further matches in the foreseeable future; stop sampling.
      break;
    }
    if (previous !== null) {
      const delta = next - previous;
      if (delta < minDelta) minDelta = delta;
    }
    previous = next;
  }
  if (minDelta < MIN_INTERVAL_MS) {
    throw new Error(
      `cron expression "${expr}" has a minimum interval of ${Math.round(minDelta / 1000)}s; minimum interval is 5 minutes (300s)`
    );
  }
}
