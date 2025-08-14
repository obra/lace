// ABOUTME: Tests for Next.js authentication middleware
// ABOUTME: Verifies route protection, JWT verification, and Edge Runtime compatibility

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { middleware, config } from '@/middleware';

// Mock jose library for Edge Runtime
vi.mock('jose', () => ({
  jwtVerify: vi.fn()
}));

// Mock environment variables
const originalEnv = process.env;

describe('Authentication Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('middleware configuration', () => {
    it('should export config with correct matcher patterns', () => {
      expect(config).toBeDefined();
      expect(config.matcher).toBeDefined();
      expect(Array.isArray(config.matcher)).toBe(true);
      
      // Should protect API routes except auth routes
      const matchers = config.matcher as string[];
      expect(matchers).toContain('/api/((?!auth).*)');
      
      // Should protect main app routes
      expect(matchers.some(matcher => matcher.includes('/'))).toBe(true);
    });
  });

  describe('request handling', () => {
    it('should allow requests to /api/auth/* routes', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/login');
      
      const response = await middleware(request);
      
      // Should pass through (return undefined or NextResponse.next())
      expect(response).toBeUndefined();
    });

    it('should allow requests to /login page', async () => {
      const request = new NextRequest('http://localhost:3000/login');
      
      const response = await middleware(request);
      
      expect(response).toBeUndefined();
    });

    it('should redirect unauthenticated requests to /login', async () => {
      const request = new NextRequest('http://localhost:3000/api/projects');
      
      const response = await middleware(request);
      
      expect(response).toBeDefined();
      expect(response!.status).toBe(307);
      expect(response!.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should allow authenticated requests with valid JWT cookie', async () => {
      process.env.LACE_JWT_SECRET = 'test-secret';
      
      const { jwtVerify } = await import('jose');
      vi.mocked(jwtVerify).mockResolvedValue({
        payload: { userId: 'test-user' },
        protectedHeader: { alg: 'HS256' }
      } as never);
      
      const request = new NextRequest('http://localhost:3000/api/projects', {
        headers: {
          cookie: 'auth-token=valid-jwt-token'
        }
      });
      
      const response = await middleware(request);
      
      expect(response).toBeUndefined();
      expect(jwtVerify).toHaveBeenCalledWith(
        'valid-jwt-token',
        expect.any(Object)
      );
    });

    it('should allow authenticated requests with valid Authorization header', async () => {
      process.env.LACE_JWT_SECRET = 'test-secret';
      
      const { jwtVerify } = await import('jose');
      vi.mocked(jwtVerify).mockResolvedValue({
        payload: { userId: 'test-user' },
        protectedHeader: { alg: 'HS256' }
      } as never);
      
      const request = new NextRequest('http://localhost:3000/api/projects', {
        headers: {
          authorization: 'Bearer valid-jwt-token'
        }
      });
      
      const response = await middleware(request);
      
      expect(response).toBeUndefined();
      expect(jwtVerify).toHaveBeenCalledWith(
        'valid-jwt-token',
        expect.any(Object)
      );
    });

    it('should redirect when JWT verification fails', async () => {
      process.env.LACE_JWT_SECRET = 'test-secret';
      
      const { jwtVerify } = await import('jose');
      vi.mocked(jwtVerify).mockRejectedValue(new Error('Invalid token'));
      
      const request = new NextRequest('http://localhost:3000/api/projects', {
        headers: {
          cookie: 'auth-token=invalid-jwt-token'
        }
      });
      
      const response = await middleware(request);
      
      expect(response).toBeDefined();
      expect(response!.status).toBe(307);
      expect(response!.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should use fallback secret when LACE_JWT_SECRET is not set', async () => {
      delete process.env.LACE_JWT_SECRET;
      
      const { jwtVerify } = await import('jose');
      vi.mocked(jwtVerify).mockResolvedValue({
        payload: { userId: 'test-user' },
        protectedHeader: { alg: 'HS256' }
      } as never);
      
      const request = new NextRequest('http://localhost:3000/api/projects', {
        headers: {
          cookie: 'auth-token=valid-jwt-token'
        }
      });
      
      const response = await middleware(request);
      
      expect(response).toBeUndefined();
      expect(jwtVerify).toHaveBeenCalledWith(
        'valid-jwt-token',
        expect.any(Object)
      );
    });

    it('should handle requests without any auth tokens', async () => {
      const request = new NextRequest('http://localhost:3000/api/projects');
      
      const response = await middleware(request);
      
      expect(response).toBeDefined();
      expect(response!.status).toBe(307);
      expect(response!.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should allow root path requests', async () => {
      const request = new NextRequest('http://localhost:3000/');
      
      const response = await middleware(request);
      
      // Root path should be accessible (might redirect to login via client-side logic)
      expect(response).toBeUndefined();
    });
  });

  describe('localhost bypass', () => {
    it('should allow localhost requests when bypass is enabled', async () => {
      process.env.LACE_ALLOW_LOCALHOST = 'true';
      
      const request = new NextRequest('http://localhost:3000/api/projects');
      
      const response = await middleware(request);
      
      expect(response).toBeUndefined();
    });

    it('should still require auth for non-localhost when bypass is enabled', async () => {
      process.env.LACE_ALLOW_LOCALHOST = 'true';
      
      const request = new NextRequest('http://example.com:3000/api/projects');
      
      const response = await middleware(request);
      
      expect(response).toBeDefined();
      expect(response!.status).toBe(307);
      expect(response!.headers.get('location')).toBe('http://example.com:3000/login');
    });
  });
});