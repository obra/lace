// ABOUTME: Cron + one-shot fire-time math. Ported verbatim from sen-core-v2/src/alarms/cron.ts.
// ABOUTME: Exports computeNextCronFire, computeNextOnceFire, assertValidIanaTimezone, assertValidCronMinInterval.

import { CronExpressionParser } from 'cron-parser';

const HOUR_MS = 60 * 60 * 1000;

// Common abbreviations are rejected because they don't carry DST rules. The agent must use
// IANA names like America/Los_Angeles so cron expressions parse against real local time.
const REJECTED_TZ_ABBREVIATIONS = new Set([
  'PST',
  'PDT',
  'EST',
  'EDT',
  'CST',
  'CDT',
  'MST',
  'MDT',
  'GMT',
  'BST',
  'IST',
]);

export function assertValidIanaTimezone(tz: string): void {
  if (typeof tz !== 'string' || tz.trim().length === 0) {
    throw new Error('timezone is required (IANA name like America/Los_Angeles)');
  }
  if (REJECTED_TZ_ABBREVIATIONS.has(tz.toUpperCase())) {
    throw new Error(
      `timezone "${tz}" is an abbreviation; use the IANA name (e.g. America/Los_Angeles)`
    );
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    throw new Error(`timezone "${tz}" is not a valid IANA name`);
  }
}

// Minimum interval check: parse the cron expression, compute the next two raw (jitter-free)
// fires, and require the delta to be at least one hour. This accepts `0 * * * *` (exactly
// hourly) and rejects `*/30 * * * *` (every 30 minutes). The check is done at registration
// time so we can reject the tool call cleanly.
export function assertValidCronMinInterval(expr: string, timezone: string): void {
  assertValidIanaTimezone(timezone);
  let interval: ReturnType<typeof CronExpressionParser.parse>;
  try {
    interval = CronExpressionParser.parse(expr, { tz: timezone });
  } catch (err) {
    throw new Error(
      `invalid cron expression "${expr}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const first = interval.next().toDate().getTime();
  const second = interval.next().toDate().getTime();
  const delta = second - first;
  if (delta < HOUR_MS) {
    throw new Error(
      `cron expression "${expr}" has an interval of ${Math.round(delta / 1000)}s; minimum interval is 1 hour`
    );
  }
}

export interface NextCronFireArgs {
  expr: string;
  timezone: string;
  after: Date;
  jitterMaxMs: number;
  // Defaults to Math.random — tests inject deterministic values.
  randomFn?: () => number;
}

export interface NextCronFire {
  rawMs: number;
  jitteredMs: number;
}

// Jitter is positive-only: rawMs + uniform(0, jitterMaxMs). Cron fires often align across
// many agents (top of the hour, etc.); positive-only jitter avoids back-firing earlier than
// the cron expression specifies while spreading load.
export function computeNextCronFire(args: NextCronFireArgs): NextCronFire {
  const random = args.randomFn ?? Math.random;
  const interval = CronExpressionParser.parse(args.expr, {
    tz: args.timezone,
    currentDate: args.after,
  });
  const rawMs = interval.next().toDate().getTime();
  const jitter = args.jitterMaxMs > 0 ? Math.floor(random() * args.jitterMaxMs) : 0;
  return { rawMs, jitteredMs: rawMs + jitter };
}

// One-shot: schedule string is an ISO-8601 timestamp. Throws on malformed input or on a
// past instant when `now` is provided.
export function computeNextOnceFire(iso: string, now?: number): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid ISO-8601 timestamp "${iso}"`);
  }
  if (typeof now === 'number' && ms < now) {
    throw new Error(`alarm time ${iso} is in the past`);
  }
  return ms;
}
