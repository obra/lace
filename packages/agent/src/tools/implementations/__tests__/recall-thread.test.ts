// ABOUTME: Tests for the `recall` tool's `thread` action — both-sides verbatim by opaque key.
// ABOUTME: Registers a trivial membership extractor and exercises ordering, budget, and loud-if-unregistered.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecallTool } from '../recall';
import { THREAD_MAX_EVENTS, THREAD_VERBATIM_BYTE_CAP } from '../recall';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';
import { appendDurableEvent, invalidatePersonaCache } from '@lace/agent/storage/event-log';
import { closeRecallIndex } from '@lace/agent/storage/recall/index-db';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins/api';
import { RECALL_EXTRACTOR_NAME } from '../recall-extractor';
import type { RecallMembershipExtractor } from '@lace/agent/plugins/api';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';

type SessionFixture = {
  laceDir: string;
  sessionId: string;
  sessionDir: string;
};

function makeSession(laceDir: string, persona: string | null = 'ada'): SessionFixture {
  const sessionId = `sess_${randomUUID()}`;
  const sessionDir = join(laceDir, 'agent-sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const meta: Record<string, unknown> = {
    sessionId,
    workDir: laceDir,
    created: new Date().toISOString(),
  };
  if (persona !== null) meta.persona = persona;
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta));
  return { laceDir, sessionId, sessionDir };
}

/** Append a prompt event carrying a `track` tag inside `data` so the trivial
 *  extractor (data.track === key) can select it. */
function appendTracked(fx: SessionFixture, text: string, track: string | null): void {
  appendDurableEvent(fx.sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 }, {
    type: 'prompt',
    data: { type: 'prompt', track, content: [{ type: 'text', text }] },
  } as unknown as Omit<TypedDurableEvent, 'eventSeq' | 'timestamp'>);
}

function makeCtx(activeSessionId: string): ToolContext {
  return { signal: new AbortController().signal, activeSessionId } as ToolContext;
}

function parseResult(result: ToolResult): Record<string, unknown> {
  expect(result.content).toHaveLength(1);
  const first = result.content[0];
  expect(first.type).toBe('text');
  if (first.type !== 'text') throw new Error('expected text block');
  return JSON.parse(first.text) as Record<string, unknown>;
}

/** Trivial test extractor: returns the event_seqs of verbatim events whose
 *  parsed `data.track === key`. The kernel passes the opaque key straight in. */
const trackExtractor: RecallMembershipExtractor = (events, key) => {
  const seqs: number[] = [];
  for (const e of events) {
    const ev = e as { eventSeq?: number; data?: { track?: unknown } };
    if (typeof ev.eventSeq === 'number' && ev.data?.track === key) seqs.push(ev.eventSeq);
  }
  return seqs;
};

describe('RecallTool thread', () => {
  let laceDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'recall-thread-'));
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
    resetRegistriesForTest();
  });

  afterEach(() => {
    closeRecallIndex();
    invalidatePersonaCache();
    resetRegistriesForTest();
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('returns matching events verbatim, ordered by event_seq ascending', async () => {
    registries.recall.register(RECALL_EXTRACTOR_NAME, trackExtractor, 'test');
    const fx = makeSession(laceDir, 'ada');
    appendTracked(fx, 'in K one', 'K'); // seq 1
    appendTracked(fx, 'off thread', 'X'); // seq 2
    appendTracked(fx, 'in K two', 'K'); // seq 3
    appendTracked(fx, 'no track', null); // seq 4
    appendTracked(fx, 'in K three', 'K'); // seq 5

    const result = await new RecallTool().execute(
      { action: 'thread', groupKey: 'K' },
      makeCtx(fx.sessionId)
    );
    const parsed = parseResult(result);
    const events = parsed.events as Array<{
      event_id: string;
      verbatim?: { eventSeq: number; data: { content: Array<{ text: string }> } };
    }>;
    expect(events.map((e) => e.event_id)).toEqual([
      `${fx.sessionId}:1`,
      `${fx.sessionId}:3`,
      `${fx.sessionId}:5`,
    ]);
    // verbatim is the original event, not the lossy render
    expect(events[0].verbatim).toBeDefined();
    expect(events[0].verbatim!.eventSeq).toBe(1);
    expect(events[0].verbatim!.data.content[0].text).toBe('in K one');
    expect(parsed.truncated).toBeUndefined();
  });

  it('caps event count (newest-first) and per-event verbatim bytes, with a truncated signal + read pointer', async () => {
    registries.recall.register(RECALL_EXTRACTOR_NAME, trackExtractor, 'test');
    const fx = makeSession(laceDir, 'ada');
    const total = THREAD_MAX_EVENTS + 25;
    // Every event is in thread K; one carries an oversized payload to trip the byte cap.
    for (let i = 0; i < total; i++) {
      const text = i === total - 1 ? 'Z'.repeat(THREAD_VERBATIM_BYTE_CAP + 5000) : `K msg ${i}`;
      appendTracked(fx, text, 'K');
    }

    const result = await new RecallTool().execute(
      { action: 'thread', groupKey: 'K' },
      makeCtx(fx.sessionId)
    );
    const parsed = parseResult(result);
    const events = parsed.events as Array<{ event_id: string; verbatim?: string }>;

    // Count is capped at THREAD_MAX_EVENTS.
    expect(events.length).toBe(THREAD_MAX_EVENTS);

    // Selection is newest-first then re-sorted ascending: the oldest (seq 1..25)
    // are dropped; results are ascending by seq.
    const seqs = events.map((e) => parseInt(e.event_id.split(':')[1], 10));
    const sortedAsc = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sortedAsc);
    expect(Math.min(...seqs)).toBeGreaterThan(25); // oldest dropped
    expect(Math.max(...seqs)).toBe(total); // newest kept

    // Per-event verbatim is capped to the byte cap (string-form after truncation).
    for (const e of events) {
      const size = Buffer.byteLength(JSON.stringify(e.verbatim ?? ''), 'utf8');
      expect(size).toBeLessThanOrEqual(THREAD_VERBATIM_BYTE_CAP + 200); // + marker overhead
    }

    // Truncated signal present with both axes + a read pointer to page the rest.
    const truncated = parsed.truncated as { events: number; bytes: number; hint: string };
    expect(truncated).toBeDefined();
    expect(truncated.events).toBe(25); // total - THREAD_MAX_EVENTS
    expect(truncated.bytes).toBeGreaterThan(0); // the oversized payload was clipped
    expect(truncated.hint).toMatch(/recall\(action:\s*['"]read['"]/);
  });

  it('returns a LOUD not-registered envelope when no extractor is registered (not a silent empty result)', async () => {
    // No extractor registered (resetRegistriesForTest cleared it in beforeEach).
    const fx = makeSession(laceDir, 'ada');
    appendTracked(fx, 'in K', 'K');

    const result = await new RecallTool().execute(
      { action: 'thread', groupKey: 'K' },
      makeCtx(fx.sessionId)
    );
    const parsed = parseResult(result);
    expect(parsed.events).toBeUndefined();
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error as string).toMatch(/no membership extractor registered/i);
  });

  it('requires groupKey for the thread action', async () => {
    registries.recall.register(RECALL_EXTRACTOR_NAME, trackExtractor, 'test');
    const fx = makeSession(laceDir, 'ada');
    appendTracked(fx, 'in K', 'K');

    const result = await new RecallTool().execute({ action: 'thread' }, makeCtx(fx.sessionId));
    const parsed = parseResult(result);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error as string).toMatch(/`thread`.*requires.*`groupKey`/);
  });
});
