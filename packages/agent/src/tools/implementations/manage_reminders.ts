// ABOUTME: manage_reminders — single tool with action enum.
// ABOUTME: Schedule/cancel/list reminders for future-self. Per spec
// ABOUTME: docs/specs/2026-05-22-alarms-coherent-design.md.

import { z } from 'zod';
import {
  assertCronAtLeast5MinInterval,
  getAgentTimezone,
} from '@lace/agent/reminders/cron';
import type { ReminderRecurs } from '@lace/agent/reminders';

const INT_STRING_RE = /^\d+$/;

// Schema is intentionally loose: action is required; everything else is optional.
// Per-action validation lives in parseManageRemindersInput.
const schema = z
  .object({
    action: z.enum(['schedule', 'cancel', 'list']),
    prompt: z.string().min(1).optional(),
    next: z.union([z.number(), z.string()]).optional(),
    recurs: z.union([z.string(), z.number()]).optional(),
    id: z.string().min(1).optional(),
  })
  .strict();

export type ManageRemindersWireInput = z.infer<typeof schema>;

export type ParsedInput =
  | {
      kind: 'schedule';
      prompt: string;
      delaySeconds: number | null;
      absoluteFireAt: number | null;
      recurs: ReminderRecurs;
    }
  | { kind: 'cancel'; id: string }
  | { kind: 'list' };

function coerceIntegerString(v: number | string, fieldName: string): number {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`\`${fieldName}\` must be a non-negative integer; got ${v}`);
    }
    return v;
  }
  // String case.
  if (v.startsWith('-')) {
    throw new Error(
      `\`${fieldName}: "${v}"\` is negative. Use a non-negative number of seconds for relative delay, or an ISO timestamp for an absolute time.`
    );
  }
  if (!INT_STRING_RE.test(v)) {
    throw new Error(`\`${fieldName}: "${v}"\` is not an integer string`);
  }
  return Number(v);
}

function parseIsoWithOffset(v: string, fieldName: string): number {
  // Require explicit offset: Z or ±HH:MM at the end.
  const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(v);
  if (!hasOffset) {
    throw new Error(
      `\`${fieldName}: "${v}"\` ISO timestamp lacks an offset. Add Z for UTC or ±HH:MM for a specific timezone, or pass \`${fieldName}: <seconds>\` for a relative delay.`
    );
  }
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid ISO timestamp "${v}"`);
  }
  return ms;
}

export function parseManageRemindersInput(rawInput: unknown): ParsedInput {
  const input = schema.parse(rawInput);

  if (input.action === 'list') {
    return { kind: 'list' };
  }

  if (input.action === 'cancel') {
    if (!input.id) throw new Error('`cancel` requires `id`');
    return { kind: 'cancel', id: input.id };
  }

  // schedule
  if (!input.prompt) throw new Error('`schedule` requires `prompt`');

  // recurs handling: string => cron; number-or-integer-string => count.
  let recurs: ReminderRecurs = null;
  let recursIsCron = false;
  if (input.recurs !== undefined) {
    // Try coercion first: if it's an integer-string, route to count.
    if (typeof input.recurs === 'string' && INT_STRING_RE.test(input.recurs)) {
      const n = Number(input.recurs);
      if (n < 2) {
        throw new Error(
          `\`recurs: ${n}\` is the same as a one-shot. Omit \`recurs\` and use \`next\` alone for a single fire.`
        );
      }
      recurs = { kind: 'count', interval_ms: 0, remaining: n }; // interval_ms filled below
    } else if (typeof input.recurs === 'number') {
      if (input.recurs < 2 || !Number.isInteger(input.recurs)) {
        throw new Error(
          input.recurs === 1
            ? '`recurs: 1` is the same as a one-shot. Omit `recurs` and use `next` alone for a single fire.'
            : `\`recurs: ${input.recurs}\` must be a positive integer ≥ 2`
        );
      }
      recurs = { kind: 'count', interval_ms: 0, remaining: input.recurs };
    } else if (typeof input.recurs === 'string') {
      // Cron expression. Reject if next was also provided.
      if (input.next !== undefined) {
        throw new Error(
          '`next` is not used with cron recurrence — cron expressions specify their own first fire. Remove `next`, or drop `recurs` if you wanted a single fire at this instant.'
        );
      }
      const tz = getAgentTimezone();
      assertCronAtLeast5MinInterval(input.recurs, tz);
      recurs = { kind: 'cron', expr: input.recurs };
      recursIsCron = true;
    }
  }

  let delaySeconds: number | null = null;
  let absoluteFireAt: number | null = null;
  if (input.next !== undefined && !recursIsCron) {
    if (typeof input.next === 'string' && !INT_STRING_RE.test(input.next)) {
      // Could be ISO or a negative integer string. Check for negative first.
      if (input.next.startsWith('-') && /^-\d+$/.test(input.next)) {
        throw new Error(
          `\`next: "${input.next}"\` is negative. Use a non-negative number of seconds for relative delay, or an ISO timestamp for an absolute time.`
        );
      }
      // ISO path.
      absoluteFireAt = parseIsoWithOffset(input.next, 'next');
    } else {
      // Numeric path.
      const seconds = coerceIntegerString(input.next, 'next');
      delaySeconds = seconds;
    }
  }

  // For count recurs, fill interval_ms from delaySeconds.
  if (recurs && recurs.kind === 'count') {
    if (delaySeconds === null) {
      throw new Error(
        "`recurs: <count>` (count) requires `next` as a number of seconds — without an interval the system doesn't know when to fire. Pass `next: <seconds>, recurs: <count>`."
      );
    }
    if (delaySeconds < 300) {
      throw new Error(
        `\`next: ${delaySeconds}\` is below the 5-minute (300s) floor for count-interval reminders`
      );
    }
    recurs = { kind: 'count', interval_ms: delaySeconds * 1000, remaining: recurs.remaining };
  }

  if (recurs === null && delaySeconds === null && absoluteFireAt === null) {
    throw new Error(
      '`schedule` requires at least one of `next` (seconds or ISO) or `recurs` (cron expression)'
    );
  }

  if (delaySeconds !== null && delaySeconds < 0) {
    throw new Error(`\`next: ${delaySeconds}\` is negative`);
  }

  return {
    kind: 'schedule',
    prompt: input.prompt,
    delaySeconds,
    absoluteFireAt,
    recurs,
  };
}

export { schema as manageRemindersSchema };
