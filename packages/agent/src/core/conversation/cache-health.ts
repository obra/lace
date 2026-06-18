// ABOUTME: Pure builder for the per-turn cache-health log signal. Turns the
// runner's accumulated cache usage into a flat structured record (with a derived
// cache-read rate) for logger.info, so a prefix-cache regression is visible in
// production immediately instead of three weeks later. No I/O, no logger here —
// the runner does the logging; this stays pure and unit-testable.

export type CacheHealthInput = {
  turnId: string;
  model: string;
  inputTokens: number; // uncached input tokens this turn (cumulative across tool-loop calls)
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  cacheMissReason: string | null;
};

export type CacheHealthLog = CacheHealthInput & { cacheReadRate: number };

export function buildCacheHealthLog(input: CacheHealthInput): CacheHealthLog {
  const denom = input.cacheReadInputTokens + input.cacheCreationInputTokens + input.inputTokens;
  const cacheReadRate = denom === 0 ? 0 : input.cacheReadInputTokens / denom;
  return { ...input, cacheReadRate };
}
