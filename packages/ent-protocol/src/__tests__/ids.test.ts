import { describe, expect, it } from 'vitest';
import { asSessionId, isSessionId, SessionIdSchema } from '../ids';

describe('SessionId validation', () => {
  describe('SessionIdSchema strict validation', () => {
    it('should accept sess_<uuid> format', () => {
      const valid = 'sess_550e8400-e29b-41d4-a716-446655440000';
      expect(() => SessionIdSchema.parse(valid)).not.toThrow();
    });

    it('should reject arbitrary alphanumeric strings', () => {
      expect(() => SessionIdSchema.parse('tmp')).toThrow();
      expect(() => SessionIdSchema.parse('private')).toThrow();
      expect(() => SessionIdSchema.parse('hello123')).toThrow();
    });

    it('should reject legacy lace_ format', () => {
      expect(() => SessionIdSchema.parse('lace_20260105_abc123')).toThrow();
    });

    it('should reject bare UUID without sess_ prefix', () => {
      expect(() => SessionIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toThrow();
    });
  });

  describe('isSessionId helper', () => {
    it('accepts valid sess_<uuid> session ids', () => {
      expect(isSessionId('sess_550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isSessionId('sess_00000000-0000-0000-0000-000000000000')).toBe(true);
      expect(isSessionId('sess_ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true);
    });

    it('rejects invalid session ids', () => {
      // Empty
      expect(isSessionId('')).toBe(false);
      // Legacy formats
      expect(isSessionId('sess_123')).toBe(false);
      expect(isSessionId('lace_20260103_abc123')).toBe(false);
      // Bare UUID
      expect(isSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
      // Path traversal attempts
      expect(isSessionId('..')).toBe(false);
      expect(isSessionId('../x')).toBe(false);
      // Short/arbitrary strings
      expect(isSessionId('tmp')).toBe(false);
      expect(isSessionId('private')).toBe(false);
    });
  });

  describe('asSessionId helper', () => {
    it('returns branded SessionId for valid input', () => {
      const id = asSessionId('sess_550e8400-e29b-41d4-a716-446655440000');
      expect(id).toBe('sess_550e8400-e29b-41d4-a716-446655440000');
    });

    it('throws for invalid values', () => {
      expect(() => asSessionId('bad/id')).toThrow();
      expect(() => asSessionId('tmp')).toThrow();
      expect(() => asSessionId('lace_20260103_abc123')).toThrow();
    });
  });
});
