// ABOUTME: Incremental, partial-line-safe tail reader for the durable JSONL shards.
// Reads only the bytes appended since a given offset and returns only newline-
// terminated lines, so a concurrently-appended (cross-process) partial line is never
// mis-parsed. Backs the injects tail-read: it reads the source of truth (the JSONL),
// so it never lags a derived index.
import * as fs from 'node:fs';

/**
 * Read newly-appended complete lines from `file` starting at byte `offset`.
 *
 * Only newline-terminated lines are returned; a trailing partial line (one not
 * yet terminated by `\n`, e.g. mid-append by another process) is held back and
 * the offset is NOT advanced past it, so it is read exactly once when complete.
 *
 * Offsets are BYTE offsets (multibyte UTF-8 means char index != byte index).
 *
 * - Missing file: returns `{ lines: [], offset }` (the offset is unchanged).
 * - `size < offset` (the file shrank — should never happen for an append-only
 *   log, but be defensive): treat it as a rotated/replaced file and re-read from
 *   0, so a replaced file is not silently skipped.
 */
export function readNewCompleteLines(
  file: string,
  offset: number
): { lines: string[]; offset: number } {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return { lines: [], offset };
  }
  try {
    const size = fs.fstatSync(fd).size;
    // Defensive: a shrunk file means it was rotated/replaced. Re-read from 0 so
    // we do not silently skip the new content.
    let from = offset;
    if (size < offset) from = 0;
    if (size <= from) return { lines: [], offset: from };
    const len = size - from;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return { lines: [], offset: from }; // no complete line yet; hold back
    const complete = text.slice(0, lastNl); // excludes the trailing partial (if any)
    const lines = complete.split('\n').filter((l) => l.length > 0);
    return { lines, offset: from + Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}
