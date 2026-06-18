// ABOUTME: Tests for readParsedSessionEvents — read + parse + sort the durable log once.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readParsedSessionEvents } from '@lace/agent/message-building/parsed-events';

describe('readParsedSessionEvents', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-pe-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads, parses, and sorts events by eventSeq from the legacy log', () => {
    // Intentionally out of order on disk; a malformed line must be skipped.
    const lines = [
      JSON.stringify({ eventSeq: 2, timestamp: 't', type: 'message', data: { content: 'b' } }),
      'not json',
      JSON.stringify({ eventSeq: 1, timestamp: 't', type: 'prompt', data: { content: 'a' } }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');

    const events = readParsedSessionEvents(dir);
    expect(events.map((e) => e.eventSeq)).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(['prompt', 'message']);
    expect(events[0].data).toEqual({ content: 'a' });
  });

  it('returns [] for an empty/missing log', () => {
    expect(readParsedSessionEvents(dir)).toEqual([]);
  });
});
