// ABOUTME: Tests for inject-tailer.ts — the partial-line-safe JSONL tail reader and
// ABOUTME: the InjectTailer that surfaces immediate injects incrementally across shards.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNewCompleteLines } from '@lace/agent/storage/inject-tailer';

describe('readNewCompleteLines', () => {
  let f: string;
  beforeEach(() => {
    f = join(mkdtempSync(join(tmpdir(), 'lace-tail-')), 'events.jsonl');
  });
  afterEach(() => rmSync(f, { recursive: true, force: true }));

  it('returns only newline-terminated lines and advances the offset past them', () => {
    writeFileSync(f, 'a\nb\n', 'utf8');
    const r1 = readNewCompleteLines(f, 0);
    expect(r1.lines).toEqual(['a', 'b']);
    expect(r1.offset).toBe(4);

    // A partial line (no trailing newline yet) is NOT returned and does not advance.
    appendFileSync(f, 'c', 'utf8');
    const r2 = readNewCompleteLines(f, r1.offset);
    expect(r2.lines).toEqual([]);
    expect(r2.offset).toBe(r1.offset); // held back

    // Once the partial line completes, it is returned exactly once.
    appendFileSync(f, '\nd\n', 'utf8');
    const r3 = readNewCompleteLines(f, r2.offset);
    expect(r3.lines).toEqual(['c', 'd']);
    expect(r3.offset).toBe(8);
  });

  it('returns {lines:[], offset} for a missing file', () => {
    expect(readNewCompleteLines(join(f, 'nope'), 0)).toEqual({ lines: [], offset: 0 });
  });
});
