// ABOUTME: Tests for authentication service combining password and token management
// ABOUTME: Verifies login, JWT verification, and integration between auth components

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { NextRequest } from 'next/server';
import {
  login,
  isAuthenticated,
  generateOneTimeLoginURL,
  exchangeOneTimeToken,
  type LoginResult
} from '@/lib/server/auth-service';
import { clearJWTSecretCache } from '@/lib/server/auth-config';

describe('Authentication Service', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'lace-auth-service-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    // Clear JWT secret cache to ensure clean state
    clearJWTSecretCache();
  });

  afterEach(() => {
    // Clean up
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('login', () => {
    it('should return success with JWT for correct password', async () => {
      // First initialize auth to get a password
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      const result = await login(password);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.jwt).toBeTruthy();
        expect(typeof result.jwt).toBe('string');
      }
    });

    it('should return failure for incorrect password', async () => {
      // First initialize auth
      const { initializeAuth } = await import('@/lib/server/auth-config');
      await initializeAuth();
      
      const result = await login('wrong-password');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it('should return failure when no auth is configured', async () => {
      const result = await login('any-password');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it('should support custom JWT expiry', async () => {
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      const result = await login(password, '7d');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.jwt).toBeTruthy();
      }
    });
  });

  describe('isAuthenticated', () => {
    it('should return true for request with valid JWT cookie', async () => {
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      const loginResult = await login(password);
      
      expect(loginResult.success).toBe(true);
      if (!loginResult.success) return;
      
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          cookie: `auth-token=${loginResult.jwt}`
        }
      });
      
      const authenticated = isAuthenticated(request);
      expect(authenticated).toBe(true);
    });

    it('should return true for request with valid Authorization header', async () => {
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      const loginResult = await login(password);
      
      expect(loginResult.success).toBe(true);
      if (!loginResult.success) return;
      
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          authorization: `Bearer ${loginResult.jwt}`
        }
      });
      
      const authenticated = isAuthenticated(request);
      expect(authenticated).toBe(true);
    });

    it('should return false for request without JWT', () => {
      const request = new NextRequest('http://localhost:3000/api/test');
      
      const authenticated = isAuthenticated(request);
      expect(authenticated).toBe(false);
    });

    it('should return false for request with invalid JWT', () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          cookie: 'auth-token=invalid-jwt-token'
        }
      });
      
      const authenticated = isAuthenticated(request);
      expect(authenticated).toBe(false);
    });
  });

  describe('generateOneTimeLoginURL', () => {
    it('should generate URL with one-time token', () => {
      const url = generateOneTimeLoginURL('http://localhost:3000');
      
      expect(url).toBeTruthy();
      expect(url).toMatch(/^http:\/\/localhost:3000\/\?token=[a-f0-9]{64}$/);
    });

    it('should generate different tokens each time', () => {
      const url1 = generateOneTimeLoginURL('http://localhost:3000');
      const url2 = generateOneTimeLoginURL('http://localhost:3000');
      
      expect(url1).not.toBe(url2);
    });
  });

  describe('exchangeOneTimeToken', () => {
    it('should return JWT for valid one-time token', () => {
      const url = generateOneTimeLoginURL('http://localhost:3000');
      const token = new URL(url).searchParams.get('token');
      
      expect(token).toBeTruthy();
      
      const jwt = exchangeOneTimeToken(token!);
      expect(jwt).toBeTruthy();
      expect(typeof jwt).toBe('string');
    });

    it('should return null for invalid token', () => {
      const jwt = exchangeOneTimeToken('invalid-token');
      expect(jwt).toBeNull();
    });

    it('should return null for used token', () => {
      const url = generateOneTimeLoginURL('http://localhost:3000');
      const token = new URL(url).searchParams.get('token');
      
      expect(token).toBeTruthy();
      
      // Use token once
      const jwt1 = exchangeOneTimeToken(token!);
      expect(jwt1).toBeTruthy();
      
      // Try to use again
      const jwt2 = exchangeOneTimeToken(token!);
      expect(jwt2).toBeNull();
    });
  });
});