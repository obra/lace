// ABOUTME: Tests for the per-session tool executor cache (cache hits, concurrency, invalidation)

import { describe, it, expect } from 'vitest';
import type { ToolExecutor } from '../tools/executor';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import { getOrCreateSessionToolExecutor, invalidateSessionToolExecutor } from '../server';

type CacheValue = { executor: ToolExecutor; toolsForProvider: CoreTool[] };
type Cache = Map<string, Promise<CacheValue>>;

function makeFakeExecutor(): CacheValue {
  // Identity-only stand-in; the cache only stores/returns the value by reference.
  return {
    executor: { __id: Math.random() } as unknown as ToolExecutor,
    toolsForProvider: [],
  };
}

describe('getOrCreateSessionToolExecutor', () => {
  it('returns the same executor for the same sessionId+executionMode (cache hit)', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const first = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    const second = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);

    expect(buildCount).toBe(1);
    expect(second.executor).toBe(first.executor);
  });

  it('builds a new executor for a different sessionId (cache miss)', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const a = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    const b = await getOrCreateSessionToolExecutor(cache, 'sess_b', 'execute', build);

    expect(buildCount).toBe(2);
    expect(b.executor).not.toBe(a.executor);
  });

  it('builds a new executor for the same sessionId but different executionMode', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const exec = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    const plan = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'plan', build);

    expect(buildCount).toBe(2);
    expect(plan.executor).not.toBe(exec.executor);
  });

  it('coalesces concurrent calls into a single in-flight build', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    let resolveBuild!: (v: CacheValue) => void;
    const pendingValue = new Promise<CacheValue>((resolve) => {
      resolveBuild = resolve;
    });
    const build = async () => {
      buildCount++;
      return pendingValue;
    };

    const p1 = getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    const p2 = getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);

    // Both should be the same in-flight promise; build only fires once.
    expect(buildCount).toBe(1);

    resolveBuild(makeFakeExecutor());
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.executor).toBe(r2.executor);
    expect(buildCount).toBe(1);
  });
});

describe('invalidateSessionToolExecutor', () => {
  it('forces a rebuild on the next call', async () => {
    const cache: Cache = new Map();
    let buildCount = 0;
    const build = async () => {
      buildCount++;
      return makeFakeExecutor();
    };

    const first = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    invalidateSessionToolExecutor(cache, 'sess_a');
    const second = await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);

    expect(buildCount).toBe(2);
    expect(second.executor).not.toBe(first.executor);
  });

  it('drops all execution modes for the invalidated session', async () => {
    const cache: Cache = new Map();
    const build = async () => makeFakeExecutor();

    await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    await getOrCreateSessionToolExecutor(cache, 'sess_a', 'plan', build);
    await getOrCreateSessionToolExecutor(cache, 'sess_b', 'execute', build);

    invalidateSessionToolExecutor(cache, 'sess_a');

    expect(cache.has('sess_a|execute|*')).toBe(false);
    expect(cache.has('sess_a|plan|*')).toBe(false);
    expect(cache.has('sess_b|execute|*')).toBe(true);
  });

  it('does not drop entries for unrelated sessions whose ids share a prefix', async () => {
    const cache: Cache = new Map();
    const build = async () => makeFakeExecutor();

    // sess_a and sess_aa would collide under naive startsWith without the "|" separator.
    await getOrCreateSessionToolExecutor(cache, 'sess_a', 'execute', build);
    await getOrCreateSessionToolExecutor(cache, 'sess_aa', 'execute', build);

    invalidateSessionToolExecutor(cache, 'sess_a');

    expect(cache.has('sess_a|execute|*')).toBe(false);
    expect(cache.has('sess_aa|execute|*')).toBe(true);
  });
});
