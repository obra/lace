import { describe, it, expect } from 'vitest';
import { buildCacheHealthLog } from '@lace/agent/core/conversation/cache-health';

describe('buildCacheHealthLog', () => {
  it('computes cache-read rate from turn usage', () => {
    const out = buildCacheHealthLog({
      turnId: 't1',
      model: 'claude-opus-4-8',
      inputTokens: 100,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 850,
      outputTokens: 20,
      cacheMissReason: null,
    });
    // read / (read + creation + uncached input)
    expect(out.cacheReadRate).toBeCloseTo(850 / (850 + 50 + 100), 5);
    expect(out.turnId).toBe('t1');
    expect(out.cacheReadInputTokens).toBe(850);
    expect(out.cacheCreationInputTokens).toBe(50);
    expect(out.cacheMissReason).toBe(null);
  });

  it('reports rate 0 when there is no cached read (cold cache)', () => {
    const out = buildCacheHealthLog({
      turnId: 't2',
      model: 'gpt-4o',
      inputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 10,
      cacheMissReason: 'first_turn',
    });
    expect(out.cacheReadRate).toBe(0);
    expect(out.cacheMissReason).toBe('first_turn');
  });

  it('avoids divide-by-zero when the turn sent no input tokens', () => {
    const out = buildCacheHealthLog({
      turnId: 't3',
      model: 'm',
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
      cacheMissReason: null,
    });
    expect(out.cacheReadRate).toBe(0);
  });
});
