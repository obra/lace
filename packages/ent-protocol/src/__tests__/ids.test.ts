import { describe, expect, it } from 'vitest';
import { asSessionId, isSessionId } from '../ids';

describe('SessionId validation', () => {
  it('accepts safe session ids', () => {
    expect(isSessionId('sess_123')).toBe(true);
    expect(isSessionId('lace_20260103_abc123')).toBe(true);
    expect(isSessionId('lace_20260103_abc123.1')).toBe(true);
    expect(isSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects unsafe session ids', () => {
    expect(isSessionId('')).toBe(false);
    expect(isSessionId('..')).toBe(false);
    expect(isSessionId('../x')).toBe(false);
    expect(isSessionId('a/../b')).toBe(false);
    expect(isSessionId('.hidden')).toBe(false);
    expect(isSessionId('-nope')).toBe(false);
    expect(isSessionId('ends.')).toBe(false);
  });

  it('asSessionId throws for invalid values', () => {
    expect(() => asSessionId('bad/id')).toThrow();
  });
});
