// ABOUTME: Tests for AgentToolScope plumbing through createToolExecutorForMode + cache key scope segment

import { describe, it, expect } from 'vitest';
import type { ToolExecutor } from '../tools/executor';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import { createToolExecutorForMode, getOrCreateSessionToolExecutor } from '../server';
import type { AgentToolScope } from '../server-types';

type CacheValue = { executor: ToolExecutor; toolsForProvider: CoreTool[] };
type Cache = Map<string, Promise<CacheValue>>;

function makeFakeExecutor(): CacheValue {
  return {
    executor: { __id: Math.random() } as unknown as ToolExecutor,
    toolsForProvider: [],
  };
}

describe('createToolExecutorForMode with AgentToolScope', () => {
  it('returns all tools when scope is undefined', async () => {
    const { toolsForProvider } = await createToolExecutorForMode(
      'execute',
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(toolsForProvider.length).toBeGreaterThan(0);
    const names = toolsForProvider.map((t) => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('bash');
  });

  it('returns no tools when scope is an empty array', async () => {
    const { toolsForProvider } = await createToolExecutorForMode(
      'execute',
      undefined,
      undefined,
      undefined,
      []
    );
    expect(toolsForProvider).toEqual([]);
  });

  it('filters tools to only those whose name is in the allowlist', async () => {
    const scope: AgentToolScope = ['file_read'];
    const { toolsForProvider } = await createToolExecutorForMode(
      'execute',
      undefined,
      undefined,
      undefined,
      scope
    );
    expect(toolsForProvider.map((t) => t.name)).toEqual(['file_read']);
  });

  it('applies scope filter before the plan-mode read/search filter', async () => {
    // bash is execute-kind; plan mode would normally drop it. Scope filter
    // runs first, then plan mode drops bash from the already-scoped set.
    const scope: AgentToolScope = ['bash', 'file_read'];
    const { toolsForProvider } = await createToolExecutorForMode(
      'plan',
      undefined,
      undefined,
      undefined,
      scope
    );
    const names = toolsForProvider.map((t) => t.name);
    expect(names).toContain('file_read');
    expect(names).not.toContain('bash');
  });

  it('returns nothing for plan mode when scope contains only execute-kind tools', async () => {
    const scope: AgentToolScope = ['bash'];
    const { toolsForProvider } = await createToolExecutorForMode(
      'plan',
      undefined,
      undefined,
      undefined,
      scope
    );
    expect(toolsForProvider).toEqual([]);
  });
});

describe('getOrCreateSessionToolExecutor with scope', () => {
  it('caches separately for different scopes on the same session+mode', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const a = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, [
      'file_read',
    ]);
    const b = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, ['bash']);

    expect(buildCount).toBe(2);
    expect(b.executor).not.toBe(a.executor);
  });

  it('treats undefined scope as wildcard "*" key', async () => {
    const cache: Cache = new Map();
    const build = async () => makeFakeExecutor();

    await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, undefined);
    expect(cache.has('sess_a|execute|*')).toBe(true);
  });

  it('produces the same cache entry for scope arrays with the same names in different order', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const first = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, [
      'file_read',
      'bash',
    ]);
    const second = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, [
      'bash',
      'file_read',
    ]);

    expect(buildCount).toBe(1);
    expect(second.executor).toBe(first.executor);
  });

  it('keys empty-array scope distinctly from undefined scope', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const wild = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, undefined);
    const empty = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build, []);

    expect(buildCount).toBe(2);
    expect(empty.executor).not.toBe(wild.executor);
    expect(cache.has('sess_a|execute|*')).toBe(true);
    expect(cache.has('sess_a|execute|')).toBe(true);
  });
});
