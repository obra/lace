// ABOUTME: Renders subagent tool_use events into human-readable job-log lines
// ABOUTME: so failed/cancelled/denied tool calls are visible alongside text
// ABOUTME: deltas in job_<id>.log (kata #39).

import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolResult } from '@lace/ent-protocol';
import { MAX_JOB_OUTPUT_BYTES } from '../server-types';

const INPUT_PREVIEW_MAX = 200;
const RESULT_PREVIEW_MAX = 400;

/**
 * Status string carried on a `tool_use` session update. The wire-level union is
 * pending/awaiting_permission/running/completed/failed/denied/cancelled/timeout
 * (see runner.ts). We accept `string` here because updates arrive from a child
 * process and are not strictly typed at the boundary.
 */
type ToolStatus = string | undefined;

/**
 * A tool_use update as observed by the parent (after the child has emitted it
 * via session/update). Only the fields the job log needs are required — the
 * formatter is tolerant about everything else.
 */
export interface ToolUseUpdate {
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  status?: ToolStatus;
  result?: ToolResult;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function summarizeInput(input: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    json = '{?}';
  }
  return truncate(json, INPUT_PREVIEW_MAX);
}

function summarizeResultContent(result: ToolResult | undefined): string {
  if (!result || !result.content || result.content.length === 0) return '';
  // Concatenate text/error message blocks; fall back to compact JSON for json
  // blocks; mark images as opaque.
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'error') {
      parts.push(block.message);
    } else if (block.type === 'json') {
      try {
        parts.push(JSON.stringify(block.data));
      } catch {
        parts.push('<json>');
      }
    } else if (block.type === 'image') {
      parts.push('<image>');
    }
  }
  return truncate(parts.join(' ').trim(), RESULT_PREVIEW_MAX);
}

/**
 * `[tool: name(input)]\n` — written once per toolCallId on first appearance,
 * before any tool_result.
 */
export function formatToolAnnouncement(name: string, input: Record<string, unknown>): string {
  return `[tool: ${name}(${summarizeInput(input)})]\n`;
}

/**
 * `[tool_result: name → ...]\n`. The marker after the arrow makes success vs.
 * failure unambiguous to a human or LLM reader:
 *   completed  → <content summary> (or "OK" when content is empty)
 *   failed     → ERROR: <message>
 *   denied     → DENIED: <message>
 *   cancelled  → CANCELLED: <message>     (permission-cancel, abort, etc.)
 *   timeout    → TIMEOUT: <message>
 *
 * `status` is preferred over `result.outcome` because the protocol surfaces
 * `awaiting_permission` etc. on the same channel, but in practice they match
 * for terminal events.
 */
export function formatToolResultLine(
  name: string,
  status: ToolStatus,
  result: ToolResult | undefined
): string {
  const summary = summarizeResultContent(result);
  const effectiveStatus = status ?? result?.outcome;

  switch (effectiveStatus) {
    case 'completed':
      return `[tool_result: ${name} → ${summary || 'OK'}]\n`;
    case 'failed':
      return `[tool_result: ${name} → ERROR: ${summary || 'unknown error'}]\n`;
    case 'denied':
      return `[tool_result: ${name} → DENIED: ${summary || 'denied'}]\n`;
    case 'cancelled':
      return `[tool_result: ${name} → CANCELLED: ${summary || 'cancelled'}]\n`;
    case 'timeout':
      return `[tool_result: ${name} → TIMEOUT: ${summary || 'timeout'}]\n`;
    default:
      // Unknown terminal status — still mark it so the log isn't silent.
      return `[tool_result: ${name} → (${effectiveStatus ?? 'unknown'}) ${summary}]\n`;
  }
}

const STATUS_IS_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'denied',
  'cancelled',
  'timeout',
]);

/**
 * Append job-log entries for a single tool_use update. Behaviour:
 *
 * - On the first appearance of `toolCallId` (any non-terminal status), writes
 *   `[tool: name(input)]`. Subsequent non-terminal updates for the same id are
 *   no-ops so we don't spam pending→awaiting_permission→running transitions.
 * - When the update carries a terminal status (or a `result`), writes
 *   `[tool_result: name → ...]`. Terminal updates that arrive without a prior
 *   announcement (e.g. denied-by-policy before pending) still produce both
 *   lines so the log is complete.
 *
 * Writes are bounded by MAX_JOB_OUTPUT_BYTES like other job-log appends.
 */
export function logToolUpdateToJobLog(
  update: ToolUseUpdate,
  seenToolCallIds: Set<string>,
  outputPath: string
): void {
  const isTerminal =
    (typeof update.status === 'string' && STATUS_IS_TERMINAL.has(update.status)) ||
    update.result !== undefined;
  const alreadyAnnounced = seenToolCallIds.has(update.toolCallId);

  const lines: string[] = [];
  if (!alreadyAnnounced) {
    lines.push(formatToolAnnouncement(update.name, update.input));
    seenToolCallIds.add(update.toolCallId);
  }
  if (isTerminal) {
    lines.push(formatToolResultLine(update.name, update.status, update.result));
  }

  if (lines.length === 0) return;
  appendBoundedJobLog(outputPath, lines.join(''));
}

/**
 * Append text to the per-job log file, honouring MAX_JOB_OUTPUT_BYTES so a
 * runaway tool_result can't blow out the log. Directory is created lazily so
 * callers don't need to pre-check.
 */
export function appendBoundedJobLog(outputPath: string, text: string): void {
  if (!existsSync(dirname(outputPath))) {
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  }
  const currentSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
  if (currentSize >= MAX_JOB_OUTPUT_BYTES) return;
  const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
  const toWrite = text.length <= remaining ? text : text.slice(0, remaining);
  appendFileSync(outputPath, toWrite, { encoding: 'utf8' });
}
