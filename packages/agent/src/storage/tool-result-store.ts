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

/** Head/tail/grep slicing options shared by read_tool_result and job_output. */
export interface SliceOpts {
  headLines?: number;
  tailLines?: number;
  grep?: string;
  grepContextChars?: number;
  headBytes?: number;
  tailBytes?: number;
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

const RECENT_SIDECARS_SHOWN = 5;

// Names the most recently spilled results, so an agent that retyped an id from
// memory can pick the one it meant. Sidecar names are the sanitized ids, which
// equal the real ids for the provider id shapes we see (letters, digits, _ and -).
function recentSidecarsNote(dir: string): string {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.txt'));
  } catch {
    return '';
  }
  if (names.length === 0) return '';
  const recent = names
    .map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RECENT_SIDECARS_SHOWN)
    .map(({ name }) => `- ${name.slice(0, -'.txt'.length)}`);
  return ` Most recently spilled tool_call_ids in this session:\n${recent.join('\n')}`;
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
 * Slice an in-memory string by head/tail/grep — the same semantics
 * `read_tool_result` uses to page a spilled sidecar, but usable directly on
 * any text (e.g. `job_output`'s in-memory job output), with no file I/O.
 *
 * - `headBytes`/`tailBytes` (if set): raw byte paging, independent of line
 *   structure, UTF-8-safe.
 * - otherwise `grep` (if set): only lines containing the substring, capped at
 *   GREP_MAX_LINES (flagged via `grepCapped`); a long single matching line is
 *   windowed around each match instead of returned whole.
 * - otherwise: the first `headLines` and/or last `tailLines`. With neither, a
 *   default head slice.
 *
 * Always reports `totalBytes` and `lineCount` of the full input.
 */
export function sliceText(full: string, opts: SliceOpts): SidecarSlice {
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
 * Describe which slice was returned, in the same wording `read_tool_result`
 * uses in its header. Shared so `job_output` can report an identical-looking
 * header for its own inline slicing.
 */
export function describeSlice(opts: SliceOpts, slice: SidecarSlice): string {
  if (opts.grep !== undefined && opts.grep !== '') {
    return `grep "${opts.grep}" → ${slice.matchedLines ?? 0} matching line(s)${
      slice.grepCapped ? ' (capped)' : ''
    }${slice.grepWindowed ? ' (long lines windowed)' : ''}`;
  }
  if (opts.headBytes !== undefined || opts.tailBytes !== undefined) {
    return describeHeadTailBytes(opts.headBytes, opts.tailBytes);
  }
  return describeHeadTail(opts.headLines, opts.tailLines);
}

function describeHeadTail(headLines?: number, tailLines?: number): string {
  const parts: string[] = [];
  if (headLines !== undefined && headLines > 0) parts.push(`head ${headLines} line(s)`);
  if (tailLines !== undefined && tailLines > 0) parts.push(`tail ${tailLines} line(s)`);
  return parts.length > 0 ? parts.join(' + ') : 'default head slice';
}

function describeHeadTailBytes(headBytes?: number, tailBytes?: number): string {
  const parts: string[] = [];
  if (headBytes !== undefined && headBytes > 0) parts.push(`head ${headBytes} byte(s)`);
  if (tailBytes !== undefined && tailBytes > 0) parts.push(`tail ${tailBytes} byte(s)`);
  return parts.length > 0 ? parts.join(' + ') : 'default head slice';
}

/**
 * Read back a slice of a previously-spilled tool result.
 *
 * Reads the full sidecar file and delegates the actual slicing to
 * `sliceText`. Throws a clear Error if the sidecar is absent.
 */
export function readToolResultSidecar(
  sessionId: string,
  toolCallId: string,
  opts: SliceOpts
): SidecarSlice {
  const filePath = sidecarPath(sessionId, toolCallId);
  let full: string;
  try {
    full = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw sidecarReadError(err, filePath, toolCallId);
  }

  return sliceText(full, opts);
}

function sidecarReadError(error: unknown, filePath: string, toolCallId: string): unknown {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return error;
  return new Error(
    `No spilled tool result found for tool_call_id "${toolCallId}" in this session ` +
      `(expected sidecar at ${filePath}). It may have ridden back whole (small enough ` +
      `to not be digested) or belong to a different session. Copy tool_call_ids from ` +
      `the digested tool result itself, never from memory.` +
      recentSidecarsNote(path.dirname(filePath))
  );
}

/** Read an entire original only when it fits the byte budget, including growth during the read. */
export function readToolResultOriginal(
  sessionId: string,
  toolCallId: string,
  maxBytes: number
): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new RangeError('Invalid original byte budget');
  const filePath = sidecarPath(sessionId, toolCallId);
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (error) {
    throw sidecarReadError(error, filePath, toolCallId);
  }
  try {
    if (fs.fstatSync(fd).size > maxBytes) throw new Error('Oversize sidecar input');
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!read) break;
      bytes += read;
    }
    if (bytes > maxBytes) throw new Error('Oversize sidecar input');
    return buffer.subarray(0, bytes).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
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
