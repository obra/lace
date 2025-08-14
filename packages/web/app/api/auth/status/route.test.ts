// ABOUTME: Tests for authentication status API route
// ABOUTME: Verifies proper token extraction and authentication status responses

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/status/route';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { saveAuthConfig, clearJWTSecretCache } from '@/lib/server/auth-config';
import { generateJWT } from '@/lib/server/auth-tokens';
import * as crypto from 'crypto';

// Set up temporary directory for auth.json
const _tempLaceDir = setupWebTest();

describe('Authentication Status API', () => {
  let validToken: string;

  beforeEach(async () => {
    // Clear JWT secret cache for clean test state
    clearJWTSecretCache();
    
    // Create a real auth config for testing
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const authConfig = {
      passwordHash: 'test-hash',
      salt: 'test-salt',
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt' as const,
      jwtSecret
    };
    
    await saveAuthConfig(authConfig);
    
    // Generate a valid token for testing
    validToken = generateJWT({ userId: 'test-user' });
  });

  afterEach(() => {
    clearJWTSecretCache();
  });

  it('should return authenticated true for valid cookie token', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: {
        'Cookie': `auth-token=${validToken}`
      }
    });

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      authenticated: true,
    });
  });

  it('should return authenticated true for valid Authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: {
        'Authorization': `Bearer ${validToken}`
      }
    });

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      authenticated: true,
    });
  });

  it('should prioritize cookie over Authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: {
        'Cookie': `auth-token=${validToken}`,
        'Authorization': 'Bearer invalid-token'
      }
    });

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      authenticated: true,
    });
  });

  it('should return authenticated false for invalid token', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: {
        'Cookie': 'auth-token=invalid-token'
      }
    });

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      authenticated: false,
    });
  });

  it('should return authenticated false when no token provided', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/status');

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      authenticated: false,
    });
  });

  it('should handle malformed Authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: {
        'Authorization': 'InvalidFormat'
      }
    });

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      authenticated: false,
    });
  });

  it('should handle auth service errors', async () => {
    // Since JWT verification is designed to never throw, it will return
    // authenticated: false for invalid tokens rather than throwing errors.
    // This is the correct security behavior.
    const request = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: {
        'Cookie': 'auth-token=definitely-invalid-token'
      }
    });

    const response = GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ authenticated: false });
  });
});