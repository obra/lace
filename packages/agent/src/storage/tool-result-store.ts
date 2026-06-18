// ABOUTME: Per-session sidecar for full tool-result payloads that were digested
// ABOUTME: out of the live context; read back by head/tail/grep via read_tool_result.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSessionDir } from './session-store';
import { advanceToCodepointBoundary, backOffToCodepointBoundary } from '../tools/result-digest';

/** Cap grep output so a pathological pattern can't re-flood the context. */
const GREP_MAX_LINES = 500;
/** When no head/tail/grep is requested, return a modest head. */
const DEFAULT_HEAD_LINES = 200;
/**
 * A matching line longer than this is windowed (±grepContextChars around each
 * match) instead of returned whole. Below it, the whole line rides back — that's
 * the right behavior for logs. Above it (e.g. a single-line JSON blob), the
 * whole line is useless, so we isolate just the needle.
 */
const GREP_LONG_LINE_THRESHOLD = 2000;
/** Default half-width (in chars) of the window kept around each match in a long line. */
const DEFAULT_GREP_CONTEXT_CHARS = 200;
/** Cap the number of windows emitted across all long-line matches. */
const GREP_MAX_WINDOWS = 200;

export interface SidecarSlice {
  content: string;
  totalBytes: number;
  lineCount: number;
  /** Present only for grep reads: number of lines returned (post-cap). */
  matchedLines?: number;
  /** Present and true only when a grep result was truncated to GREP_MAX_LINES. */
  grepCapped?: boolean;
  /** Present and true when at least one long matching line was windowed. */
  grepWindowed?: boolean;
}

/**
 * Reduce a tool_call_id to a safe filename: only `[A-Za-z0-9_-]` survive; every
 * other character (including path separators and `..`) becomes `_`. This is the
 * sole defense against path traversal into or out of the session dir.
 */
function safeFileName(toolCallId: string): string {
  const sanitized = toolCallId.replace(/[^A-Za-z0-9_-]/g, '_');
  // Guard against an all-stripped id collapsing to empty.
  return sanitized.length > 0 ? sanitized : '_';
}

function sidecarPath(sessionId: string, toolCallId: string): string {
  const dir = path.join(getSessionDir(sessionId), 'tool-results');
  return path.join(dir, `${safeFileName(toolCallId)}.txt`);
}

export function writeToolResultSidecar(sessionId: string, toolCallId: string, full: string): void {
  const filePath = sidecarPath(sessionId, toolCallId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, full, { mode: 0o600 });
}

/**
 * Read back a slice of a previously-spilled tool result.
 *
 * - `grep` (if set): only lines containing the substring, capped at
 *   GREP_MAX_LINES (flagged via `grepCapped`).
 * - otherwise: the first `headLines` and/or last `tailLines`. With neither, a
 *   default head slice.
 *
 * Always reports `totalBytes` and `lineCount` of the full file. Throws a clear
 * Error if the sidecar is absent.
 */
export function readToolResultSidecar(
  sessionId: string,
  toolCallId: string,
  opts: {
    headLines?: number;
    tailLines?: number;
    grep?: string;
    grepContextChars?: number;
    headBytes?: number;
    tailBytes?: number;
  }
): SidecarSlice {
  const filePath = sidecarPath(sessionId, toolCallId);
  let full: string;
  try {
    full = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No spilled tool result found for tool_call_id "${toolCallId}" in this session ` +
          `(expected sidecar at ${filePath}). It may have ridden back whole (small enough ` +
          `to not be digested) or belong to a different session.`
      );
    }
    throw err;
  }

  const totalBytes = Buffer.byteLength(full, 'utf8');
  // Drop a single trailing newline so a file ending in "\n" doesn't count an
  // empty final line.
  const body = full.endsWith('\n') ? full.slice(0, -1) : full;
  const lines = body.length === 0 ? [] : body.split('\n');
  const lineCount = lines.length;

  // Byte-range paging: explicit head/tail by raw bytes, independent of line
  // structure. UTF-8-safe — boundaries are pulled back/advanced off any partial
  // codepoint so the returned text is always valid.
  if (opts.headBytes !== undefined || opts.tailBytes !== undefined) {
    const buf = Buffer.from(full, 'utf8');
    const parts: string[] = [];
    if (opts.headBytes !== undefined && opts.headBytes > 0) {
      const end = backOffToCodepointBoundary(buf, Math.min(opts.headBytes, buf.length));
      parts.push(buf.subarray(0, end).toString('utf8'));
    }
    if (opts.tailBytes !== undefined && opts.tailBytes > 0) {
      const start = advanceToCodepointBoundary(buf, Math.max(0, buf.length - opts.tailBytes));
      parts.push(buf.subarray(start).toString('utf8'));
    }
    return { content: parts.join('\n'), totalBytes, lineCount };
  }

  if (opts.grep !== undefined && opts.grep !== '') {
    const needle = opts.grep;
    const contextChars = opts.grepContextChars ?? DEFAULT_GREP_CONTEXT_CHARS;
    const matches = lines.filter((l) => l.includes(needle));
    const capped = matches.length > GREP_MAX_LINES;
    const returned = capped ? matches.slice(0, GREP_MAX_LINES) : matches;

    let windowed = false;
    const rendered = returned.map((line) => {
      if (line.length <= GREP_LONG_LINE_THRESHOLD) return line;
      windowed = true;
      return windowLine(line, needle, contextChars);
    });

    return {
      content: rendered.join('\n'),
      totalBytes,
      lineCount,
      matchedLines: returned.length,
      ...(capped ? { grepCapped: true } : {}),
      ...(windowed ? { grepWindowed: true } : {}),
    };
  }

  const headLines = opts.headLines;
  const tailLines = opts.tailLines;
  if (headLines === undefined && tailLines === undefined) {
    return {
      content: lines.slice(0, DEFAULT_HEAD_LINES).join('\n'),
      totalBytes,
      lineCount,
    };
  }

  const parts: string[] = [];
  if (headLines !== undefined && headLines > 0) {
    parts.push(lines.slice(0, headLines).join('\n'));
  }
  if (tailLines !== undefined && tailLines > 0) {
    parts.push(lines.slice(Math.max(0, lineCount - tailLines)).join('\n'));
  }
  return {
    content: parts.join('\n'),
    totalBytes,
    lineCount,
  };
}

/**
 * Isolate the needle inside a single very-long line: emit a ±`contextChars`
 * window around each match occurrence, joined with a `…` separator. The result
 * is prefixed/suffixed with `…` when content was dropped at that edge.
 * Windows are capped at GREP_MAX_WINDOWS; further matches are summarized.
 */
function windowLine(line: string, needle: string, contextChars: number): string {
  const offsets: number[] = [];
  let from = 0;
  for (;;) {
    const at = line.indexOf(needle, from);
    if (at === -1) break;
    offsets.push(at);
    from = at + needle.length;
    if (offsets.length >= GREP_MAX_WINDOWS) break;
  }

  // Build [start, end) windows around each match, then merge any that overlap
  // or touch so an emitted segment is contiguous text from the line.
  const ranges: Array<[number, number]> = [];
  for (const at of offsets) {
    const start = Math.max(0, at - contextChars);
    const end = Math.min(line.length, at + needle.length + contextChars);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  const leadingTruncated = ranges[0][0] > 0;
  const trailingTruncated = ranges[ranges.length - 1][1] < line.length;
  let out = ranges.map(([s, e]) => line.slice(s, e)).join(' … ');
  if (leadingTruncated) out = `…${out}`;
  if (trailingTruncated) out = `${out}…`;
  if (offsets.length >= GREP_MAX_WINDOWS) {
    out = `${out}\n…[${GREP_MAX_WINDOWS}+ matches in this line, windows capped]`;
  }
  return out;
}
