// ABOUTME: Tests for one-time token exchange API route
// ABOUTME: Verifies token exchange functionality and JWT cookie setting

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/exchange/route';
import * as authTokens from '@/lib/server/auth-tokens';
import { cookies } from 'next/headers';

// Mock auth tokens service
vi.mock('@/lib/server/auth-tokens');

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    set: vi.fn(),
  })),
}));

describe('POST /api/auth/exchange', () => {
  const mockConsumeOneTimeToken = vi.mocked(authTokens.consumeOneTimeToken);
  const mockCookies = vi.mocked(cookies);
  const mockSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockReturnValue({ set: mockSet } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should exchange valid one-time token for JWT', async () => {
    mockConsumeOneTimeToken.mockReturnValue('valid-jwt-token');

    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        token: 'valid-one-time-token',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      jwt: 'valid-jwt-token',
    });
    expect(mockConsumeOneTimeToken).toHaveBeenCalledWith('valid-one-time-token');
  });

  it('should set auth cookie for exchanged token', async () => {
    mockConsumeOneTimeToken.mockReturnValue('valid-jwt-token');

    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        token: 'valid-one-time-token',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await POST(request);

    expect(mockSet).toHaveBeenCalledWith('auth-token', 'valid-jwt-token', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour in seconds
    });
  });

  it('should return 401 for invalid one-time token', async () => {
    mockConsumeOneTimeToken.mockReturnValue(null);

    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        token: 'invalid-one-time-token',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      error: 'Invalid or expired token',
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('should return 401 for expired one-time token', async () => {
    mockConsumeOneTimeToken.mockReturnValue(null);

    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        token: 'expired-one-time-token',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      error: 'Invalid or expired token',
    });
  });

  it('should return 400 for missing token', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Token is required',
    });
    expect(mockConsumeOneTimeToken).not.toHaveBeenCalled();
  });

  it('should return 400 for empty token', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        token: '',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Token is required',
    });
    expect(mockConsumeOneTimeToken).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: 'invalid-json',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Invalid request format',
    });
    expect(mockConsumeOneTimeToken).not.toHaveBeenCalled();
  });

  it('should handle token service errors', async () => {
    mockConsumeOneTimeToken.mockImplementation(() => {
      throw new Error('Token service unavailable');
    });

    const request = new NextRequest('http://localhost:3000/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        token: 'any-token',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Token exchange failed',
    });
  });
});