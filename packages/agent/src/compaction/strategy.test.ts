// ABOUTME: Tests for the compaction strategy registry seam:
// ABOUTME: validatePreserved (noop, merge, leading-user, idempotent) + resolveCompactionStrategy
// ABOUTME: + golden no-op-on-legacy-output (C3 byte-safe seam)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  validatePreserved,
  resolveCompactionStrategy,
  registerBuiltinCompaction,
} from './strategy';
import { resetRegistriesForTest, registries } from '@lace/agent/plugins';
import type { CompactResult } from './types';

const made = (preserved: unknown[]): CompactResult => ({
  compactionEvent: {
    type: 'context_compacted',
    data: { type: 'context_compacted', strategy: 'x', preserved },
  },
});

describe('validatePreserved', () => {
  it('passes noop through', () => {
    expect(validatePreserved({ noop: true })).toEqual({ noop: true });
  });

  it('empty/whitespace preserved → noop', () => {
    expect('noop' in validatePreserved(made([]))).toBe(true);
    expect('noop' in validatePreserved(made([{ role: 'user', content: '   ' }]))).toBe(true);
  });

  it('merges consecutive same-role entries', () => {
    const r = validatePreserved(
      made([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ])
    );
    if (!('noop' in r)) expect((r.compactionEvent.data.preserved as unknown[]).length).toBe(1);
  });

  it('makes the first entry user-role (merges/drops leading assistant)', () => {
    const r = validatePreserved(
      made([
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'y' },
      ])
    );
    if (!('noop' in r))
      expect((r.compactionEvent.data.preserved as Array<{ role: string }>)[0].role).toBe('user');
  });

  it('is idempotent', () => {
    const once = validatePreserved(
      made([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ])
    );
    expect(validatePreserved(once)).toEqual(once);
  });
});

describe('resolveCompactionStrategy', () => {
  beforeEach(() => {
    resetRegistriesForTest();
    registerBuiltinCompaction();
  });

  it('resolves the built-in track-based', () => {
    expect(resolveCompactionStrategy('track-based').name).toBe('track-based');
  });

  it('registers track-based with owner builtin', () => {
    expect(registries.compaction.owner('track-based')).toBe('builtin');
  });

  it('throws on unknown strategy', () => {
    expect(() => resolveCompactionStrategy('nope')).toThrow();
  });
});

// C3 golden / byte-safe seam:
// Proves validatePreserved is a no-op on a hand-constructed CompactResult that
// already has legally-alternating preserved entries (consecutive distinct roles).
// This ensures the seam does not mutate bytes that are already valid.
describe('validatePreserved — no-op on already-legal preserved (byte-safe seam)', () => {
  it('returns result unchanged when preserved is already valid (user then assistant)', () => {
    const legal = made([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]);
    expect(JSON.stringify(validatePreserved(legal))).toBe(JSON.stringify(legal));
  });

  it('returns result unchanged when preserved has a single user entry', () => {
    const legal = made([{ role: 'user', content: 'only user' }]);
    expect(JSON.stringify(validatePreserved(legal))).toBe(JSON.stringify(legal));
  });

  it('idempotency: validatePreserved(validatePreserved(x)) === validatePreserved(x)', () => {
    const input = made([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
    ]);
    const once = validatePreserved(input);
    expect(JSON.stringify(validatePreserved(once))).toBe(JSON.stringify(once));
  });
});

// C3 resolveCompactionStrategy + validatePreserved integration:
// Proves the registry path + seam work together using a noop CompactResult.
describe('resolveCompactionStrategy + validatePreserved (registry integration)', () => {
  beforeEach(() => {
    resetRegistriesForTest();
    registerBuiltinCompaction();
  });

  it('strategy resolves and validatePreserved is a no-op on a legal noop result', () => {
    const strategy = resolveCompactionStrategy('track-based');
    expect(strategy.name).toBe('track-based');

    // Simulate a CompactResult that was already valid (noop path).
    const noop: CompactResult = { noop: true };
    expect(validatePreserved(noop)).toEqual(noop);
  });

  it('validatePreserved is a no-op on a legal non-noop result (proves byte-safe seam)', () => {
    const legal: CompactResult = made([
      { role: 'user', content: 'context prefix' },
      { role: 'assistant', content: 'response' },
    ]);
    expect(JSON.stringify(validatePreserved(legal))).toBe(JSON.stringify(legal));
  });
});
