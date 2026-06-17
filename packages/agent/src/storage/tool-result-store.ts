// ABOUTME: Per-session sidecar for full tool-result payloads that were digested
// ABOUTME: out of the live context; read back by head/tail/grep via read_tool_result.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSessionDir } from './session-store';

/** Cap grep output so a pathological pattern can't re-flood the context. */
const GREP_MAX_LINES = 500;
/** When no head/tail/grep is requested, return a modest head. */
const DEFAULT_HEAD_LINES = 200;

export interface SidecarSlice {
  content: string;
  totalBytes: number;
  lineCount: number;
  /** Present only for grep reads: number of lines returned (post-cap). */
  matchedLines?: number;
  /** Present and true only when a grep result was truncated to GREP_MAX_LINES. */
  grepCapped?: boolean;
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
  opts: { headLines?: number; tailLines?: number; grep?: string }
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

  if (opts.grep !== undefined && opts.grep !== '') {
    const needle = opts.grep;
    const matches = lines.filter((l) => l.includes(needle));
    const capped = matches.length > GREP_MAX_LINES;
    const returned = capped ? matches.slice(0, GREP_MAX_LINES) : matches;
    return {
      content: returned.join('\n'),
      totalBytes,
      lineCount,
      matchedLines: returned.length,
      ...(capped ? { grepCapped: true } : {}),
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
