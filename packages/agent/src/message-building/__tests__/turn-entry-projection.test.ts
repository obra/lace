// ABOUTME: Tests for loadTurnEntryProjection — one read+parse of the durable log,
// three derivations (messages+systemPrompt, files-read, last-turn-end seq). The
// read-count gate proves the log is read exactly once at turn entry.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pe from '@lace/agent/message-building/parsed-events';
import { loadTurnEntryProjection } from '@lace/agent/message-building/turn-entry-projection';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';

describe('loadTurnEntryProjection', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-tep-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reads the log exactly once and returns all three derivations', () => {
    const lines = [
      JSON.stringify({
        eventSeq: 1,
        timestamp: 't',
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'sys' },
      }),
      JSON.stringify({
        eventSeq: 2,
        timestamp: 't',
        type: 'prompt',
        data: { content: [{ type: 'text', text: 'hi' }] },
      }),
      JSON.stringify({
        eventSeq: 3,
        timestamp: 't',
        type: 'message',
        data: { content: [{ type: 'text', text: 'hello' }] },
      }),
      JSON.stringify({
        eventSeq: 4,
        timestamp: 't',
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');

    const spy = vi.spyOn(pe, 'readParsedSessionEvents');
    const proj = loadTurnEntryProjection(dir, '/work');

    expect(spy).toHaveBeenCalledTimes(1); // the whole point: ONE read+parse
    expect(proj.systemPrompt).toBe('sys');
    expect(proj.lastTurnEndSeq).toBe(4);
    expect(proj.filesRead instanceof Set).toBe(true);
    // messages equivalence with the standalone builder:
    expect(JSON.stringify(proj.messages)).toBe(
      JSON.stringify(buildProviderMessagesFromDurableEvents(dir).messages)
    );
  });
});
