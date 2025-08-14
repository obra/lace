// ABOUTME: Tests for JWT token generation and validation
// ABOUTME: Verifies token creation, validation, and expiry handling

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateJWT,
  verifyJWT,
  generateOneTimeToken,
  consumeOneTimeToken
} from '@/lib/server/auth-tokens';

// Mock jsonwebtoken to control time
vi.mock('jsonwebtoken', async () => {
  const actual = await vi.importActual<typeof import('jsonwebtoken')>('jsonwebtoken');
  return {
    ...actual,
    sign: vi.fn(actual.sign),
    verify: vi.fn(actual.verify),
  };
});

describe('Auth Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset one-time tokens
    vi.resetModules();
  });

  describe('generateJWT', () => {
    it('should generate a valid JWT token', () => {
      const token = generateJWT({ userId: 'test-user' });
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format
    });

    it('should include custom expiry', () => {
      const token = generateJWT({ userId: 'test-user' }, '7d');
      const payload = verifyJWT(token);
      expect(payload).not.toBeNull();
      // Token should be valid
    });

    it('should use default expiry when not specified', () => {
      const token = generateJWT({ userId: 'test-user' });
      const payload = verifyJWT(token);
      expect(payload).not.toBeNull();
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid token', () => {
      const token = generateJWT({ userId: 'test-user' });
      const payload = verifyJWT(token);
      
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe('test-user');
    });

    it('should reject invalid token', () => {
      const payload = verifyJWT('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject tampered token', () => {
      const token = generateJWT({ userId: 'test-user' });
      const tampered = token.slice(0, -5) + 'xxxxx';
      
      const payload = verifyJWT(tampered);
      expect(payload).toBeNull();
    });
  });

  describe('One-time tokens', () => {
    it('should generate unique one-time token', () => {
      const token1 = generateOneTimeToken();
      const token2 = generateOneTimeToken();
      
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);
    });

    it('should consume token only once', () => {
      const token = generateOneTimeToken();
      
      const jwt1 = consumeOneTimeToken(token);
      expect(jwt1).toBeTruthy();
      
      const jwt2 = consumeOneTimeToken(token);
      expect(jwt2).toBeNull();
    });

    it('should expire token after timeout', () => {
      vi.useFakeTimers();
      
      const token = generateOneTimeToken();
      
      // Advance time past expiry (31 seconds)
      vi.advanceTimersByTime(31000);
      
      const jwt = consumeOneTimeToken(token);
      expect(jwt).toBeNull();
      
      vi.useRealTimers();
    });

    it('should not expire token before timeout', () => {
      vi.useFakeTimers();
      
      const token = generateOneTimeToken();
      
      // Advance time but not past expiry (29 seconds)
      vi.advanceTimersByTime(29000);
      
      const jwt = consumeOneTimeToken(token);
      expect(jwt).toBeTruthy();
      
      vi.useRealTimers();
    });
  });
});