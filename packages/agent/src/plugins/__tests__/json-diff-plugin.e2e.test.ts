// ABOUTME: End-to-end test for the json-diff-plugin example.
// ABOUTME: Loads through the real loader into real registries, exercises real
// ABOUTME: RFC 6902 JSON Patch diff computation on real input values — no mocks.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '@lace/agent/tools/builtins';
import { ToolExecutor } from '@lace/agent/tools/executor';
import type { ToolContext } from '@lace/agent/tools/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same pattern as the
// whole-system integration test.
const PLUGIN_SPEC = './__examples__/json-diff-plugin';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    signal: new AbortController().signal,
    ...overrides,
  };
}

// Convenience: parse the result body from a completed tool result.
function parseResult(text: string | undefined): {
  patch: unknown[];
  summary: Record<string, unknown>;
} {
  return JSON.parse(text ?? '{}') as { patch: unknown[]; summary: Record<string, unknown> };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('json-diff-plugin — end-to-end', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    registerBuiltinTools(); // built-ins before plugins (dup→fatal)
    await loadPlugins(PLUGIN_SPEC);
  });

  // ── Registry / loader surface ─────────────────────────────────────────────

  it('tool is drawn into a session executor alongside built-ins', () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    expect(ex.getTool('json-diff/diff')).toBeDefined();
    expect(ex.getTool('bash')).toBeDefined(); // built-in still present
  });

  it('owner is recorded as the plugin meta.name', () => {
    expect(registries.tools.owner('json-diff/diff')).toBe('json-diff');
    expect(registries.tools.owner('bash')).toBe('builtin');
  });

  // ── Identical documents ───────────────────────────────────────────────────

  it('returns an empty patch for identical documents', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const doc = JSON.stringify({ a: 1, b: [1, 2, 3] });
    const result = await tool.execute({ before: doc, after: doc }, makeCtx());
    expect(result.status).toBe('completed');

    const body = parseResult(result.content[0].text);
    expect(body.patch).toEqual([]);
    expect(body.summary.identical).toBe(true);
    expect(body.summary.total).toBe(0);
  });

  // ── Object-level diffs ────────────────────────────────────────────────────

  it('detects a replaced scalar value in an object', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute(
      {
        before: JSON.stringify({ name: 'Alice', age: 30 }),
        after: JSON.stringify({ name: 'Alice', age: 31 }),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.replaced).toBe(1);
    expect(body.summary.added).toBe(0);
    expect(body.summary.removed).toBe(0);

    const replaceOp = (body.patch as Array<{ op: string; path: string; value: unknown }>).find(
      (o) => o.op === 'replace'
    );
    expect(replaceOp).toBeDefined();
    expect(replaceOp!.path).toBe('/age');
    expect(replaceOp!.value).toBe(31);
  });

  it('detects an added key', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute(
      {
        before: JSON.stringify({ a: 1 }),
        after: JSON.stringify({ a: 1, b: 'new' }),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.added).toBe(1);
    const addOp = (body.patch as Array<{ op: string; path: string; value: unknown }>).find(
      (o) => o.op === 'add'
    );
    expect(addOp).toBeDefined();
    expect(addOp!.path).toBe('/b');
    expect(addOp!.value).toBe('new');
  });

  it('detects a removed key', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute(
      {
        before: JSON.stringify({ a: 1, b: 'old' }),
        after: JSON.stringify({ a: 1 }),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.removed).toBe(1);
    const removeOp = (body.patch as Array<{ op: string; path: string }>).find(
      (o) => o.op === 'remove'
    );
    expect(removeOp).toBeDefined();
    expect(removeOp!.path).toBe('/b');
  });

  it('diffs a nested object structure at fine granularity', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const before = { user: { name: 'Bob', role: 'viewer' }, active: true };
    const after = { user: { name: 'Bob', role: 'admin' }, active: true };

    const result = await tool.execute(
      { before: JSON.stringify(before), after: JSON.stringify(after) },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    // Should produce exactly one replace at /user/role, not a wholesale /user replace.
    expect(body.summary.total).toBe(1);
    const ops = body.patch as Array<{ op: string; path: string; value: unknown }>;
    expect(ops[0].op).toBe('replace');
    expect(ops[0].path).toBe('/user/role');
    expect(ops[0].value).toBe('admin');
  });

  // ── Array-level diffs ─────────────────────────────────────────────────────

  it('detects an element added to an array', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute(
      {
        before: JSON.stringify([1, 2, 3]),
        after: JSON.stringify([1, 2, 3, 4]),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.added).toBe(1);
    const addOp = (body.patch as Array<{ op: string; path: string; value: unknown }>).find(
      (o) => o.op === 'add'
    );
    expect(addOp).toBeDefined();
    expect(addOp!.value).toBe(4);
  });

  it('detects an element removed from an array', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute(
      {
        before: JSON.stringify(['a', 'b', 'c']),
        after: JSON.stringify(['a', 'c']),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.removed).toBe(1);
    const removeOp = (body.patch as Array<{ op: string; path: string }>).find(
      (o) => o.op === 'remove'
    );
    expect(removeOp).toBeDefined();
  });

  it('handles a reordered array by producing the correct edit script', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    // [1,2,3] → [3,1,2]: the patch should move elements to reach the target.
    const result = await tool.execute(
      {
        before: JSON.stringify([1, 2, 3]),
        after: JSON.stringify([3, 1, 2]),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);
    // We don't prescribe the exact ops (LCS choices vary) but the patch must be non-empty.
    expect((body.patch as unknown[]).length).toBeGreaterThan(0);
  });

  // ── Top-level type changes ────────────────────────────────────────────────

  it('replaces when the top-level type changes (object → array)', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute(
      {
        before: JSON.stringify({ key: 'value' }),
        after: JSON.stringify([1, 2, 3]),
      },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.replaced).toBe(1);
    const replaceOp = (body.patch as Array<{ op: string; path: string; value: unknown }>)[0];
    expect(replaceOp.op).toBe('replace');
    expect(replaceOp.path).toBe('');
    expect(replaceOp.value).toEqual([1, 2, 3]);
  });

  it('replaces null with a value', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute({ before: 'null', after: '"hello"' }, makeCtx());
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    expect(body.summary.replaced).toBe(1);
  });

  // ── JSON Pointer escaping ─────────────────────────────────────────────────

  it('escapes tildes and slashes in key names per RFC 6901', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    // Keys with '/' and '~' must be escaped in JSON Pointer paths.
    const before = { 'a/b': 1, 'c~d': 2 };
    const after = { 'a/b': 99, 'c~d': 99 };

    const result = await tool.execute(
      { before: JSON.stringify(before), after: JSON.stringify(after) },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);

    const paths = (body.patch as Array<{ path: string }>).map((o) => o.path);
    expect(paths).toContain('/a~1b'); // '/' escaped as '~1'
    expect(paths).toContain('/c~0d'); // '~' escaped as '~0'
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns an error result for invalid JSON in before', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute({ before: '{not valid json', after: '{}' }, makeCtx());
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toMatch(/invalid json.*before/i);
  });

  it('returns an error result for invalid JSON in after', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const result = await tool.execute({ before: '{}', after: 'this is not json' }, makeCtx());
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toMatch(/invalid json.*after/i);
  });

  it('returns an error for an empty before string (Zod validation)', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    // The Zod schema requires min(1), so an empty string should fail validation.
    const result = await tool.execute({ before: '', after: '{}' }, makeCtx());
    expect(result.status).toBe('failed');
  });

  // ── Complex real-world scenario ───────────────────────────────────────────

  it('correctly diffs a realistic config object change', async () => {
    const ex = new ToolExecutor();
    ex.registerAllAvailableTools();
    const tool = ex.getTool('json-diff/diff')!;

    const before = {
      version: '1.2.0',
      features: { darkMode: false, notifications: true },
      users: ['alice', 'bob'],
      maxRetries: 3,
    };
    const after = {
      version: '1.3.0',
      features: { darkMode: true, notifications: true },
      users: ['alice', 'bob', 'carol'],
      timeout: 5000,
    };

    const result = await tool.execute(
      { before: JSON.stringify(before), after: JSON.stringify(after) },
      makeCtx()
    );
    expect(result.status).toBe('completed');
    const body = parseResult(result.content[0].text);
    const ops = body.patch as Array<{ op: string; path: string; value?: unknown }>;

    // version replaced
    const versionOp = ops.find((o) => o.path === '/version');
    expect(versionOp?.op).toBe('replace');
    expect(versionOp?.value).toBe('1.3.0');

    // darkMode replaced
    const darkOp = ops.find((o) => o.path === '/features/darkMode');
    expect(darkOp?.op).toBe('replace');
    expect(darkOp?.value).toBe(true);

    // notifications unchanged — should NOT appear in the patch
    expect(ops.find((o) => o.path === '/features/notifications')).toBeUndefined();

    // carol added to users array
    const carolOp = ops.find((o) => o.op === 'add' && o.value === 'carol');
    expect(carolOp).toBeDefined();

    // maxRetries removed
    const removeOp = ops.find((o) => o.op === 'remove' && o.path === '/maxRetries');
    expect(removeOp).toBeDefined();

    // timeout added
    const timeoutOp = ops.find((o) => o.path === '/timeout');
    expect(timeoutOp?.op).toBe('add');
    expect(timeoutOp?.value).toBe(5000);
  });
});
