// ABOUTME: Incremental, partial-line-safe tail reader for the durable JSONL shards.
// Reads only the bytes appended since a given offset and returns only newline-
// terminated lines, so a concurrently-appended (cross-process) partial line is never
// mis-parsed. Backs the injects tail-read: it reads the source of truth (the JSONL),
// so it never lags a derived index.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listTranscriptFiles } from './transcript-paths';
import { getSessionDir } from './session-store';

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

/**
 * Extract concatenated text from a context_injected event's content blocks.
 * Mirrors message-builder.ts's handling: only text blocks contribute. Shared by
 * the tailer and the runner's full-scan oracle so both read injects identically.
 */
export function extractInjectedText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n');
}

/**
 * The exact shard file set `readAllSessionEventLines` reads: the legacy
 * `<sessionDir>/events.jsonl` (when present) followed by the new-layout
 * `<laceDir>/transcripts/<persona>/<date>/<sessionId>.jsonl` shards. We reuse the
 * same discovery so the tailer reads precisely the files the full scan does.
 */
function sessionShardFiles(laceDir: string, sessionId: string): string[] {
  let newFiles: string[] = [];
  try {
    newFiles = listTranscriptFiles(laceDir, sessionId);
  } catch {
    newFiles = [];
  }
  let legacyPath: string | undefined;
  try {
    legacyPath = path.join(getSessionDir(sessionId), 'events.jsonl');
  } catch {
    legacyPath = undefined;
  }
  return legacyPath && fs.existsSync(legacyPath) ? [legacyPath, ...newFiles] : newFiles;
}

/**
 * A stateful, incremental reader for `priority='immediate'` context_injected
 * events across a session's JSONL shards. Created once per turn, seeded with the
 * turn-entry watermark.
 *
 * `readNew()` reads only the bytes appended since the last call (per shard, to
 * the last complete newline — partial lines are held back), parses them, and
 * returns the text of any immediate inject with `eventSeq > watermark`, advancing
 * the watermark + per-shard offsets. Because it reads the JSONL (the source of
 * truth), a cross-process inject is seen the instant its line lands.
 *
 * The `eventSeq > watermark` filter is kept even though byte offsets already
 * prevent re-reading bytes: it dedups across a brand-new shard whose early events
 * are <= the watermark (belt-and-suspenders).
 */
export type InjectTailer = {
  readNew(): { injections: string[]; newWatermark: number };
};

export function createInjectTailer(
  laceDir: string,
  sessionId: string,
  afterEventSeq: number
): InjectTailer {
  const offsets = new Map<string, number>();
  let watermark = afterEventSeq;

  return {
    readNew(): { injections: string[]; newWatermark: number } {
      // Gather newly-appended events from every shard, then process them in
      // eventSeq order — mirroring readAllSessionEventLines' global sort so the
      // watermark advances over a strictly monotonic stream (cross-shard seqs can
      // otherwise interleave, e.g. a legacy file read before a new shard).
      const parsedEvents: { eventSeq: number; type: unknown; data: unknown }[] = [];
      for (const file of sessionShardFiles(laceDir, sessionId)) {
        // A shard not yet in the map is new this turn; start from byte 0.
        const startOffset = offsets.get(file) ?? 0;
        const { lines, offset } = readNewCompleteLines(file, startOffset);
        offsets.set(file, offset);
        for (const line of lines) {
          let parsed: { eventSeq?: unknown; type?: unknown; data?: unknown };
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            continue; // ignore malformed line
          }
          if (typeof parsed.eventSeq !== 'number') continue;
          parsedEvents.push({ eventSeq: parsed.eventSeq, type: parsed.type, data: parsed.data });
        }
      }
      parsedEvents.sort((a, b) => a.eventSeq - b.eventSeq);

      const injections: string[] = [];
      for (const e of parsedEvents) {
        if (e.eventSeq <= watermark) continue;
        watermark = e.eventSeq;
        if (e.type !== 'context_injected') continue;
        const data = e.data as { content?: unknown; priority?: unknown };
        if (data.priority !== 'immediate') continue;
        const text = extractInjectedText(data.content);
        if (text.trim()) injections.push(text);
      }
      return { injections, newWatermark: watermark };
    },
  };
}
