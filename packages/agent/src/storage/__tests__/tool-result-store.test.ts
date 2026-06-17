// ABOUTME: Tests for the per-session tool-result sidecar store.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToolResultSidecar, writeToolResultSidecar } from '../tool-result-store';
import { getSessionDir } from '../session-store';

const TEST_SESSION_ID = 'sess_550e8400-e29b-41d4-a716-446655440000';

describe('storage/tool-result-store', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-tool-result-store-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makePayload(): { full: string; lineCount: number } {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`line ${i}: ${'padding '.repeat(4)}marker-${i % 7}`);
    }
    const full = lines.join('\n') + '\n';
    // Trailing newline produces lines.length non-empty lines (split drops the
    // final empty segment in the store's counting).
    return { full, lineCount: lines.length };
  }

  it('writes the full payload and reads back the head', () => {
    const { full } = makePayload();
    expect(Buffer.byteLength(full, 'utf8')).toBeGreaterThan(50 * 1024 - 1);
    writeToolResultSidecar(TEST_SESSION_ID, 'tc_head', full);

    const slice = readToolResultSidecar(TEST_SESSION_ID, 'tc_head', { headLines: 3 });
    expect(slice.content).toBe(
      'line 0: padding padding padding padding marker-0\n' +
        'line 1: padding padding padding padding marker-1\n' +
        'line 2: padding padding padding padding marker-2'
    );
    expect(slice.totalBytes).toBe(Buffer.byteLength(full, 'utf8'));
    expect(slice.lineCount).toBe(2000);
  });

  it('reads back the tail', () => {
    const { full } = makePayload();
    writeToolResultSidecar(TEST_SESSION_ID, 'tc_tail', full);

    const slice = readToolResultSidecar(TEST_SESSION_ID, 'tc_tail', { tailLines: 2 });
    expect(slice.content).toBe(
      'line 1998: padding padding padding padding marker-3\n' +
        'line 1999: padding padding padding padding marker-4'
    );
  });

  it('reads back grep matches', () => {
    const { full } = makePayload();
    writeToolResultSidecar(TEST_SESSION_ID, 'tc_grep', full);

    const slice = readToolResultSidecar(TEST_SESSION_ID, 'tc_grep', { grep: 'marker-0' });
    const matchLines = slice.content.split('\n');
    // marker-0 appears for i % 7 === 0 across 2000 lines.
    expect(matchLines.length).toBeGreaterThan(0);
    expect(matchLines.every((l) => l.includes('marker-0'))).toBe(true);
    expect(slice.matchedLines).toBe(matchLines.length);
  });

  it('defaults to a head slice when no options are given', () => {
    const { full } = makePayload();
    writeToolResultSidecar(TEST_SESSION_ID, 'tc_default', full);

    const slice = readToolResultSidecar(TEST_SESSION_ID, 'tc_default', {});
    const lines = slice.content.split('\n');
    expect(lines[0]).toBe('line 0: padding padding padding padding marker-0');
    expect(lines.length).toBeLessThan(2000); // capped to a default head
  });

  it('throws a clear error when the sidecar is absent', () => {
    expect(() => readToolResultSidecar(TEST_SESSION_ID, 'tc_missing', { headLines: 5 })).toThrow(
      /tc_missing/
    );
  });

  it('sanitizes the tool_call_id so it cannot escape the session dir', () => {
    const evil = '../../etc/passwd';
    writeToolResultSidecar(TEST_SESSION_ID, evil, 'secret\n');

    const sessionDir = getSessionDir(TEST_SESSION_ID);
    const sidecarDir = join(sessionDir, 'tool-results');
    // Every file written for this id stays inside the session's tool-results dir.
    expect(existsSync(sidecarDir)).toBe(true);
    const entries = readdirSync(sidecarDir);
    expect(entries.length).toBe(1);
    // No path separators survive into the filename.
    expect(entries[0]).not.toContain('/');
    expect(entries[0]).not.toContain('..');

    // And it round-trips under the same (sanitized) id.
    const slice = readToolResultSidecar(TEST_SESSION_ID, evil, { headLines: 1 });
    expect(slice.content).toBe('secret');
  });
});
