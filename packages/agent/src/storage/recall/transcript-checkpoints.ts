// ABOUTME: Stores the byte prefix of each transcript already processed by recall
// ABOUTME: Reads raw JSONL lines within the opened file's size snapshot

import * as fs from 'node:fs';
import type { Db } from './index-db';

export const TRANSCRIPT_CHECKPOINTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS transcript_checkpoints (
  file_path     TEXT PRIMARY KEY NOT NULL,
  device        TEXT    NOT NULL,
  inode         TEXT    NOT NULL,
  mtime_ns      INTEGER NOT NULL,
  observed_size INTEGER NOT NULL,
  byte_offset   INTEGER NOT NULL
);
`;

type TranscriptCheckpoint = {
  device: string;
  inode: string;
  mtime_ns: bigint;
  observed_size: bigint;
  byte_offset: bigint;
};

export function transcriptCheckpoints(db: Db) {
  const read = db
    .prepare<
      [string],
      TranscriptCheckpoint
    >('SELECT device, inode, mtime_ns, observed_size, byte_offset FROM transcript_checkpoints WHERE file_path = ?')
    .safeIntegers();
  const write = db.prepare(`
    INSERT OR REPLACE INTO transcript_checkpoints
      (file_path, device, inode, mtime_ns, observed_size, byte_offset)
      VALUES (?, ?, ?, ?, ?, ?)
  `);
  return {
    get(filePath: string): TranscriptCheckpoint | undefined {
      return read.get(filePath);
    },
    save(filePath: string, file: fs.BigIntStats, offset: bigint): void {
      write.run(filePath, String(file.dev), String(file.ino), file.mtimeNs, file.size, offset);
    },
  };
}

/** Return the next byte to read, or null if the file is already caught up. */
export function transcriptStart(
  file: fs.BigIntStats,
  checkpoint: TranscriptCheckpoint | undefined
): bigint | null {
  if (
    !checkpoint ||
    String(file.dev) !== checkpoint.device ||
    String(file.ino) !== checkpoint.inode ||
    file.size < checkpoint.observed_size
  ) {
    return 0n;
  }
  if (file.size === checkpoint.byte_offset) {
    return file.mtimeNs === checkpoint.mtime_ns ? null : 0n;
  }
  return checkpoint.byte_offset;
}

export function* readTranscriptLines(
  fd: number,
  start: bigint,
  size: bigint
): Generator<{ line: string; end: bigint | null }> {
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let fragments: Buffer[] = [];
  let position = start;
  while (position < size) {
    const length = Math.min(chunk.length, Number(size - position));
    const bytesRead = fs.readSync(fd, chunk, 0, length, position);
    if (bytesRead === 0) return; // The opened file shortened during the read.

    const bytes = chunk.subarray(0, bytesRead);
    let lineStart = 0;
    for (let lf = bytes.indexOf(0x0a); lf !== -1; lf = bytes.indexOf(0x0a, lineStart)) {
      const tail = bytes.subarray(lineStart, lf);
      const line = fragments.length > 0 ? Buffer.concat([...fragments, tail]) : tail;
      fragments = [];
      lineStart = lf + 1;
      yield { line: line.toString('utf8'), end: position + BigInt(lineStart) };
    }
    // A UTF-8 character can span reads. Decode only after assembling the
    // entire line, copying bytes that will outlive the reusable buffer.
    if (lineStart < bytesRead) fragments.push(Buffer.from(bytes.subarray(lineStart)));
    position += BigInt(bytesRead);
  }
  if (fragments.length > 0) {
    yield { line: Buffer.concat(fragments).toString('utf8'), end: null };
  }
}
