// ABOUTME: Tests for the `recall` built-in tool — search + read actions.
// ABOUTME: Real SQLite + filesystem; seeds events via appendDurableEvent (write-through to FTS).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecallTool } from '../recall';
import { ToolExecutor, LACE_BUILTIN_TOOL_NAMES } from '@lace/agent/tools/executor';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';
import { appendDurableEvent, invalidatePersonaCache } from '@lace/agent/storage/event-log';
import { closeRecallIndex } from '@lace/agent/storage/recall/index-db';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';

function makeCtx(): ToolContext {
  return { signal: new AbortController().signal } as ToolContext;
}

describe('RecallTool registration', () => {
  it('is included in LACE_BUILTIN_TOOL_NAMES', () => {
    expect(LACE_BUILTIN_TOOL_NAMES).toContain('recall');
  });

  it('is registered by registerAllAvailableTools', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const tool = executor.getTool('recall');
    expect(tool).toBeDefined();
    expect(tool).toBeInstanceOf(RecallTool);
    expect(tool!.name).toBe('recall');
  });
});

describe('RecallTool schema', () => {
  const tool = new RecallTool();

  // The schema is intentionally flat (single zod object with optional fields)
  // because lace's tool-catalog JSON-Schema converter rejects discriminated
  // unions. Per-action required-field checks live in executeValidated and
  // are exercised in the "runtime per-action validation" block below.

  it('accepts a valid search input', () => {
    expect(() => tool.schema.parse({ action: 'search', query: 'x' })).not.toThrow();
  });

  it('accepts a valid read input', () => {
    expect(() => tool.schema.parse({ action: 'read', event_id: 'evt_1' })).not.toThrow();
  });

  it('accepts search with all optional fields', () => {
    expect(() =>
      tool.schema.parse({
        action: 'search',
        query: 'hello',
        persona: ['ada', 'bea'],
        session_id: 's1',
        since: '2026-01-01',
        until: '2026-12-31',
        limit: 25,
      })
    ).not.toThrow();
  });

  it('accepts read with context and full', () => {
    expect(() =>
      tool.schema.parse({ action: 'read', event_id: 'evt_1', context: 5, full: true })
    ).not.toThrow();
  });

  it('rejects an unknown action', () => {
    expect(() => tool.schema.parse({ action: 'bogus' })).toThrow();
  });

  it('rejects search with an empty query', () => {
    // An empty string still fails zod's .min(1) constraint on the optional field.
    expect(() => tool.schema.parse({ action: 'search', query: '' })).toThrow();
  });

  it('rejects limit above max', () => {
    expect(() => tool.schema.parse({ action: 'search', query: 'x', limit: 1000 })).toThrow();
  });

  it('rejects context above max', () => {
    expect(() => tool.schema.parse({ action: 'read', event_id: 'e', context: 1000 })).toThrow();
  });

  it('exposes a JSON-Schema-convertible inputSchema (object type, not anyOf)', () => {
    // Regression guard: the tool-catalog conversion in Tool#inputSchema only
    // accepts an object-typed top-level schema. A discriminated union compiles
    // to anyOf and throws "Invalid schema structure for tool recall".
    expect(() => tool.inputSchema).not.toThrow();
    expect(tool.inputSchema.type).toBe('object');
  });
});

describe('RecallTool runtime per-action validation', () => {
  it('returns an error result when search is called without query', async () => {
    const tool = new RecallTool();
    const result = await tool.execute({ action: 'search' }, makeCtx());
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== 'text') throw new Error('expected text block');
    const parsed = JSON.parse(first.text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error!).toMatch(/`search`.*requires.*`query`/);
  });

  it('returns an error result when read is called without event_id', async () => {
    const tool = new RecallTool();
    const result = await tool.execute({ action: 'read' }, makeCtx());
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== 'text') throw new Error('expected text block');
    const parsed = JSON.parse(first.text) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(parsed.error!).toMatch(/`read`.*requires.*`event_id`/);
  });
});

// ---------------------------------------------------------------------------
// Live-execution tests: stand up a real laceDir, seed events via the real
// write path (which write-through-indexes into FTS), then exercise the tool.
// ---------------------------------------------------------------------------

type SessionFixture = {
  laceDir: string;
  sessionId: string;
  sessionDir: string;
  persona: string | null;
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
  return { laceDir, sessionId, sessionDir, persona };
}

function parseResult(result: ToolResult): Record<string, unknown> {
  expect(result.content).toHaveLength(1);
  const first = result.content[0];
  expect(first.type).toBe('text');
  if (first.type !== 'text') throw new Error('expected text block');
  return JSON.parse(first.text) as Record<string, unknown>;
}

function appendPrompt(fixture: SessionFixture, text: string): void {
  appendDurableEvent(fixture.sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 }, {
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text }] },
  } as Omit<TypedDurableEvent, 'eventSeq' | 'timestamp'>);
}

function appendMessage(fixture: SessionFixture, text: string): void {
  appendDurableEvent(fixture.sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 }, {
    type: 'message',
    data: { type: 'message', content: [{ type: 'text', text }] },
  } as Omit<TypedDurableEvent, 'eventSeq' | 'timestamp'>);
}

function appendToolCall(fixture: SessionFixture, name: string, resultText: string): void {
  appendDurableEvent(fixture.sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 }, {
    type: 'tool_use',
    data: {
      type: 'tool_use',
      toolCallId: `tc_${randomUUID()}`,
      name,
      input: { arg: 'value' },
      result: { content: [{ type: 'text', text: resultText }] },
    },
  } as Omit<TypedDurableEvent, 'eventSeq' | 'timestamp'>);
}

function appendTurnStart(fixture: SessionFixture): void {
  appendDurableEvent(fixture.sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 }, {
    type: 'turn_start',
    data: { type: 'turn_start' },
  } as Omit<TypedDurableEvent, 'eventSeq' | 'timestamp'>);
}

describe('RecallTool search', () => {
  let laceDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'recall-search-'));
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
  });

  afterEach(() => {
    closeRecallIndex();
    invalidatePersonaCache();
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('returns hits matching the query with default limit 10', async () => {
    const fx = makeSession(laceDir, 'ada');
    for (let i = 0; i < 15; i++) appendPrompt(fx, `needle ${i}`);

    const tool = new RecallTool();
    const result = await tool.execute({ action: 'search', query: 'needle' }, makeCtx());
    const parsed = parseResult(result);

    expect(Array.isArray(parsed.hits)).toBe(true);
    const hits = parsed.hits as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(10);
    for (const h of hits) {
      expect(h.session_id).toBe(fx.sessionId);
      expect(h.kind).toBe('user_message');
      expect(typeof h.preview).toBe('string');
      expect(h.persona).toBe('ada');
    }
  });

  it('respects an explicit limit', async () => {
    const fx = makeSession(laceDir, 'ada');
    for (let i = 0; i < 5; i++) appendPrompt(fx, `needle ${i}`);

    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', limit: 3 },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect((parsed.hits as unknown[]).length).toBe(3);
  });

  it('filters by persona as a single string', async () => {
    const ada = makeSession(laceDir, 'ada');
    const bea = makeSession(laceDir, 'bea');
    appendPrompt(ada, 'shared needle ada');
    appendPrompt(bea, 'shared needle bea');

    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', persona: 'ada' },
      makeCtx()
    );
    const hits = parseResult(result).hits as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(1);
    expect(hits[0].persona).toBe('ada');
  });

  it('filters by persona as an array', async () => {
    const ada = makeSession(laceDir, 'ada');
    const bea = makeSession(laceDir, 'bea');
    const cara = makeSession(laceDir, 'cara');
    appendPrompt(ada, 'shared needle a');
    appendPrompt(bea, 'shared needle b');
    appendPrompt(cara, 'shared needle c');

    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', persona: ['ada', 'bea'] },
      makeCtx()
    );
    const hits = parseResult(result).hits as Array<Record<string, unknown>>;
    expect(hits.map((h) => h.persona).sort()).toEqual(['ada', 'bea']);
  });

  it('filters by session_id', async () => {
    const a = makeSession(laceDir, 'ada');
    const b = makeSession(laceDir, 'ada');
    appendPrompt(a, 'needle one');
    appendPrompt(b, 'needle two');

    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', session_id: a.sessionId },
      makeCtx()
    );
    const hits = parseResult(result).hits as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(1);
    expect(hits[0].session_id).toBe(a.sessionId);
  });

  it('filters by since timestamp', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'needle old');
    const cutoff = new Date(Date.now() + 1000).toISOString();
    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', since: cutoff },
      makeCtx()
    );
    const hits = parseResult(result).hits as unknown[];
    expect(hits).toHaveLength(0);
  });

  it('filters by until timestamp', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'needle new');
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', until: cutoff },
      makeCtx()
    );
    const hits = parseResult(result).hits as unknown[];
    expect(hits).toHaveLength(0);
  });

  it('redacts secrets in previews', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'Bearer xoxb-1234567890-abcdefghij-abcdefghij here');

    const result = await new RecallTool().execute({ action: 'search', query: 'Bearer' }, makeCtx());
    const hits = parseResult(result).hits as Array<{ preview: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].preview).toContain('<REDACTED:slack>');
    expect(hits[0].preview).not.toContain('xoxb-');
  });

  it('returns a hint-laden empty result on zero hits', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'something');

    const result = await new RecallTool().execute(
      { action: 'search', query: 'xyznevermatches' },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.hits).toEqual([]);
    expect(typeof parsed.hint).toBe('string');
    expect(parsed.hint as string).toMatch(/0 hits/);
    expect(parsed.hint as string).toMatch(/xyznevermatches/);
  });

  it('mentions the persona filter in the zero-hits hint', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'something');
    const result = await new RecallTool().execute(
      { action: 'search', query: 'xyznevermatches', persona: 'ada' },
      makeCtx()
    );
    const hint = parseResult(result).hint as string;
    expect(hint).toMatch(/ada/);
  });

  it('does not echo secrets verbatim in the FTS5 error hint (I1)', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'something');

    // AKIA secret embedded in a broken query so we hit the error path
    const result = await new RecallTool().execute(
      { action: 'search', query: 'AKIAIOSFODNN7EXAMPLE AND' },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.hits).toEqual([]);
    expect(parsed.hint as string).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(parsed.hint as string).toContain('<REDACTED:aws-access-key>');
  });

  it('does not echo secrets verbatim in the zero-hit hint (I1)', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'unrelated');

    const result = await new RecallTool().execute(
      { action: 'search', query: 'AKIAIOSFODNN7EXAMPLE' },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.hits).toEqual([]);
    expect(parsed.hint as string).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(parsed.hint as string).toContain('<REDACTED:aws-access-key>');
  });

  it('order: recent sorts hits by ts DESC (I5)', async () => {
    // Seed FTS rows directly with distinct timestamps so the ordering test
    // is deterministic (appendDurableEvent uses new Date().toISOString()
    // which can collide within a tight loop).
    const { getRecallIndex } = await import('@lace/agent/storage/recall/index-db');
    const { insertRow } = await import('@lace/agent/storage/recall/index-writer');
    const sessionId = `sess_${randomUUID()}`;
    const db = getRecallIndex();
    // Events 1..5 are "old" (2024); 6..10 are "new" (2026). All match
    // the query "needle".
    for (let i = 1; i <= 10; i++) {
      const year = i <= 5 ? 2024 : 2026;
      const ts = `${year}-01-01T00:00:${String(i).padStart(2, '0')}Z`;
      insertRow(db, {
        event_id: `${sessionId}:${i}`,
        session_id: sessionId,
        ts,
        persona: 'ada',
        kind: 'user_message',
        content: `needle ${i}`,
      });
    }

    const result = await new RecallTool().execute(
      { action: 'search', query: 'needle', order: 'recent', limit: 5 },
      makeCtx()
    );
    const hits = parseResult(result).hits as Array<{ ts: string; event_id: string }>;
    expect(hits).toHaveLength(5);
    // ts strings sorted DESC
    const tsList = hits.map((h) => h.ts);
    const sorted = [...tsList].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(tsList).toEqual(sorted);
    // The newest 5 (seq 6..10) must be present; the older 5 (1..5) must not.
    const seqs = hits.map((h) => parseInt(h.event_id.split(':')[1], 10));
    for (const s of seqs) expect(s).toBeGreaterThanOrEqual(6);
  });

  it('returns the FTS5-syntax-error hint envelope instead of throwing on broken queries (C3)', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'something');

    const tool = new RecallTool();
    // Each of these triggers an FTS5 SqliteError at prepare/all time. We
    // catch and convert to a zero-hit envelope with a hint; the conversation
    // turn must not crash. (Lowercase 'and'/'or' are NOT operators in FTS5
    // — they're just non-matching words — so they're omitted here.)
    const broken = ['AND', '"unclosed', '-foo', '*', ':', '(('];
    for (const q of broken) {
      const result = await tool.execute({ action: 'search', query: q }, makeCtx());
      const parsed = parseResult(result);
      expect(parsed.hits).toEqual([]);
      expect(typeof parsed.hint).toBe('string');
      expect(parsed.hint as string).toMatch(/FTS5 syntax error/);
    }
  });

  it('respects AND semantics across multiple filters', async () => {
    const a = makeSession(laceDir, 'ada');
    const b = makeSession(laceDir, 'bea');
    appendPrompt(a, 'needle alpha');
    appendPrompt(b, 'needle alpha');

    const result = await new RecallTool().execute(
      {
        action: 'search',
        query: 'needle',
        persona: 'ada',
        session_id: a.sessionId,
      },
      makeCtx()
    );
    const hits = parseResult(result).hits as Array<{ session_id: string; persona: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].session_id).toBe(a.sessionId);
    expect(hits[0].persona).toBe('ada');
  });
});

describe('RecallTool read', () => {
  let laceDir: string;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'recall-read-'));
    process.env.LACE_DIR = laceDir;
    invalidatePersonaCache();
  });

  afterEach(() => {
    closeRecallIndex();
    invalidatePersonaCache();
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('returns the target plus N before and N after, ordered by eventSeq', async () => {
    const fx = makeSession(laceDir, 'ada');
    for (let i = 0; i < 10; i++) appendPrompt(fx, `msg ${i}`);

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:5`, context: 2 },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{ event_id: string }>;
    expect(events).toHaveLength(5); // seq 3..7
    expect(events.map((e) => e.event_id)).toEqual([
      `${fx.sessionId}:3`,
      `${fx.sessionId}:4`,
      `${fx.sessionId}:5`,
      `${fx.sessionId}:6`,
      `${fx.sessionId}:7`,
    ]);
  });

  it('defaults context to 5 when unspecified', async () => {
    const fx = makeSession(laceDir, 'ada');
    for (let i = 0; i < 20; i++) appendPrompt(fx, `msg ${i}`);

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:10` },
      makeCtx()
    );
    const events = parseResult(result).events as unknown[];
    expect(events).toHaveLength(11); // seq 5..15
  });

  it('returns the target event in full even when full=false', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'first');
    // Target is a 600-char tool_call; under full=false context tool_calls
    // would be truncated to 500, but the target must come back complete.
    appendToolCall(fx, 'mytool', 'X'.repeat(600));
    appendPrompt(fx, 'last');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:2`, context: 1 },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      content: string;
    }>;
    const target = events.find((e) => e.event_id === `${fx.sessionId}:2`);
    expect(target).toBeDefined();
    // Full content: tool=mytool\ninput=...\nresult=XXXX (600 X's)
    expect(target!.content).toContain('X'.repeat(600));
    expect(target!.content).not.toContain('[truncated');
  });

  it('truncates context tool_call events to 500 chars when full=false', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendToolCall(fx, 'big', 'B'.repeat(800));
    appendPrompt(fx, 'target');
    appendPrompt(fx, 'after');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:2`, context: 2 },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      content: string;
      kind: string;
    }>;
    const toolEv = events.find((e) => e.event_id === `${fx.sessionId}:1`);
    expect(toolEv).toBeDefined();
    expect(toolEv!.kind).toBe('tool_call');
    expect(toolEv!.content.length).toBeLessThan(600); // 500 + marker overhead
    expect(toolEv!.content).toMatch(/\.\.\. \[truncated, \d+ more chars\]$/);
  });

  it('returns all context events in full when full=true (capped at 10k)', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendToolCall(fx, 'big', 'B'.repeat(2000));
    appendPrompt(fx, 'target');
    appendPrompt(fx, 'after');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:2`, context: 2, full: true },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      content: string;
    }>;
    const toolEv = events.find((e) => e.event_id === `${fx.sessionId}:1`);
    expect(toolEv).toBeDefined();
    expect(toolEv!.content).toContain('B'.repeat(2000));
    expect(toolEv!.content).not.toContain('[truncated');
  });

  it('applies the 10k cap to oversized user_message content', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'A'.repeat(12_000));
    appendPrompt(fx, 'after');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:1`, context: 1 },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      content: string;
    }>;
    const target = events.find((e) => e.event_id === `${fx.sessionId}:1`);
    expect(target).toBeDefined();
    expect(target!.content).toMatch(/\.\.\. \[truncated, 2000 more chars\]$/);
    expect(target!.content.startsWith('A'.repeat(10_000))).toBe(true);
  });

  it('redacts secrets in content', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendToolCall(fx, 'envdump', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE rest');
    appendPrompt(fx, 'after');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:1`, context: 1, full: true },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      content: string;
    }>;
    const target = events.find((e) => e.event_id === `${fx.sessionId}:1`);
    expect(target).toBeDefined();
    expect(target!.content).toContain('<REDACTED:aws-access-key>');
    expect(target!.content).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('returns an error with format hint when event_id is malformed', async () => {
    const result = await new RecallTool().execute(
      { action: 'read', event_id: 'not-a-real-id' },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error as string).toMatch(/malformed/);
    expect(parsed.error as string).toMatch(/<session_id>:<eventSeq>/);
  });

  it('returns a structured error envelope when session_id is malformed (not a ZodError)', async () => {
    // The event_id regex accepts any non-colon prefix, but getSessionDir calls
    // asSessionId which throws ZodError on non-sess_<uuid> input. The Tool
    // execute wrapper would turn that into a "ValidationError: recall failed"
    // text result — NOT the JSON {error, ...} envelope other recall errors
    // use. Validate the session_id shape inside read() to keep the envelope
    // consistent.
    const result = await new RecallTool().execute({ action: 'read', event_id: 'foo:1' }, makeCtx());
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== 'text') throw new Error('expected text block');
    // The wrapper's ValidationError surfaces as raw text starting with
    // "ValidationError:". Our envelope is JSON-parseable.
    expect(first.text).not.toMatch(/^ValidationError:/);
    const parsed = JSON.parse(first.text) as { error?: string };
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error as string).toMatch(/malformed session_id/);
    expect(parsed.error as string).toMatch(/sess_<uuid>/);
  });

  it('returns an error with session-stats hint when event_id is unknown', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'one');
    appendPrompt(fx, 'two');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:99999` },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.error as string).toMatch(/not found/);
    expect(parsed.hint as string).toMatch(/2 events/);
  });

  it('reports "no events" when the session is entirely unknown', async () => {
    const unknownId = `sess_${randomUUID()}`;
    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${unknownId}:1` },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.error as string).toMatch(/not found/);
    expect(parsed.hint as string).toMatch(/No events found/);
  });

  it('rejects an uppercase-UUID session_id (I2 — regex must not be case-insensitive)', async () => {
    // asSessionId in @lace/ent-protocol is case-sensitive. Recall's own
    // validator must match exactly, otherwise an uppercase event_id slips
    // past our envelope guard and surfaces as a ValidationError text block.
    const result = await new RecallTool().execute(
      { action: 'read', event_id: 'sess_AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA:1' },
      makeCtx()
    );
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== 'text') throw new Error('expected text block');
    expect(first.text).not.toMatch(/^ValidationError:/);
    const parsed = JSON.parse(first.text) as { error?: string };
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error as string).toMatch(/malformed session_id/);
  });

  it('redacts secrets in event_id error envelopes (I1)', async () => {
    // Inject a Slack token into a malformed event_id. The error message
    // echoes the input; it must be redacted.
    const result = await new RecallTool().execute(
      { action: 'read', event_id: 'xoxb-1234567890-abcdefghij-abcdefghij:1' },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.error as string).not.toContain('xoxb-');
    expect(parsed.error as string).toContain('<REDACTED:slack>');
  });

  it('does not crash on a malformed event in the context window (I3)', async () => {
    // C2 hardening of eventToRow plus the recall.read fallback for
    // null-row events together mean a malformed event inside the requested
    // window comes back as kind=<event.type>, content="" without throwing.
    const sessionId = `sess_${randomUUID()}`;
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ sessionId, workDir: laceDir, created: 'x', persona: 'ada' })
    );
    // 5 events; seq=3 has no content
    const lines = [
      JSON.stringify({
        eventSeq: 1,
        timestamp: '2026-05-23T00:00:01Z',
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'one' }] },
      }),
      JSON.stringify({
        eventSeq: 2,
        timestamp: '2026-05-23T00:00:02Z',
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'two' }] },
      }),
      JSON.stringify({
        eventSeq: 3,
        timestamp: '2026-05-23T00:00:03Z',
        type: 'message',
        data: { role: 'assistant' }, // MALFORMED — no content
      }),
      JSON.stringify({
        eventSeq: 4,
        timestamp: '2026-05-23T00:00:04Z',
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'four' }] },
      }),
      JSON.stringify({
        eventSeq: 5,
        timestamp: '2026-05-23T00:00:05Z',
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'five' }] },
      }),
    ].join('\n');
    writeFileSync(join(sessionDir, 'events.jsonl'), lines + '\n');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${sessionId}:3`, context: 2 },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      kind: string;
      content: string;
    }>;
    // The malformed event surfaces minimally; surrounding good events read fine.
    expect(events.map((e) => e.event_id)).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
    const malformed = events.find((e) => e.event_id === `${sessionId}:3`);
    expect(malformed).toBeDefined();
    expect(malformed!.content).toBe('');
  });

  it('hints about index/disk divergence when JSONL is missing but FTS knows the session (I4)', async () => {
    // Insert FTS rows for a session whose JSONL doesn't exist on disk —
    // simulates a pruned/deleted transcript whose index entries linger.
    // read should not pretend the session is unknown; the hint must
    // surface the divergence so the agent can act.
    const { getRecallIndex } = await import('@lace/agent/storage/recall/index-db');
    const { insertRow } = await import('@lace/agent/storage/recall/index-writer');
    const sessionId = `sess_${randomUUID()}`;
    const db = getRecallIndex();
    insertRow(db, {
      event_id: `${sessionId}:1`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:01Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'phantom',
    });
    insertRow(db, {
      event_id: `${sessionId}:2`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:02Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'phantom2',
    });

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${sessionId}:1` },
      makeCtx()
    );
    const parsed = parseResult(result);
    expect(parsed.error as string).toMatch(/not found/);
    expect(parsed.hint as string).toMatch(/0 events on disk/);
    expect(parsed.hint as string).toMatch(/2 events in the index/);
  });

  it('returns a structured error envelope (not raw text) when agentSessionsDir() throws', async () => {
    // Force SessionStorageError by pointing LACE_SESSION_DIR at a path nobody
    // can mkdir (existing file's "name as a directory"). The thrown error
    // would otherwise escape the tool wrapper as "ValidationError: recall
    // failed" plain text; the envelope wrapper converts it to {error: ...}.
    const blocker = join(laceDir, 'definitely-a-file');
    writeFileSync(blocker, 'i am a file, not a dir');
    const savedSessionDir = process.env.LACE_SESSION_DIR;
    process.env.LACE_SESSION_DIR = join(blocker, 'subpath-that-cannot-exist');

    try {
      const result = await new RecallTool().execute(
        {
          action: 'read',
          event_id: 'sess_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1',
        },
        makeCtx()
      );
      expect(result.content).toHaveLength(1);
      const first = result.content[0];
      if (first.type !== 'text') throw new Error('expected text block');
      expect(first.text).not.toMatch(/^ValidationError:/);
      const parsed = JSON.parse(first.text) as { error?: string };
      expect(typeof parsed.error).toBe('string');
      // Must include enough detail to be actionable but must NOT be raw text.
      expect(parsed.error as string).toMatch(/read/);
    } finally {
      if (savedSessionDir === undefined) delete process.env.LACE_SESSION_DIR;
      else process.env.LACE_SESSION_DIR = savedSessionDir;
    }
  });

  it('surfaces non-indexable events in the range minimally without crashing', async () => {
    const fx = makeSession(laceDir, 'ada');
    appendPrompt(fx, 'before');
    appendTurnStart(fx); // not indexable
    appendPrompt(fx, 'target');
    appendPrompt(fx, 'after');

    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${fx.sessionId}:3`, context: 2 },
      makeCtx()
    );
    const events = parseResult(result).events as Array<{
      event_id: string;
      kind: string;
      content: string;
    }>;
    expect(events.map((e) => e.event_id)).toEqual([
      `${fx.sessionId}:1`,
      `${fx.sessionId}:2`,
      `${fx.sessionId}:3`,
      `${fx.sessionId}:4`,
    ]);
    const turnStart = events.find((e) => e.event_id === `${fx.sessionId}:2`);
    expect(turnStart).toBeDefined();
    expect(turnStart!.kind).toBe('turn_start');
    expect(turnStart!.content).toBe('');
  });
});
