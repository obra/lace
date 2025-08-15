// ABOUTME: Tests for login API route
// ABOUTME: Verifies password authentication, JWT token generation, and cookie management

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/login/route';
import * as authService from '@/lib/server/auth-service';
import { cookies } from 'next/headers';

// Mock auth service
vi.mock('@/lib/server/auth-service');

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    set: vi.fn(),
  })),
}));

describe('POST /api/auth/login', () => {
  const mockLogin = vi.mocked(authService.login);
  const mockCookies = vi.mocked(cookies);
  const mockSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockReturnValue({ set: mockSet } as never);
  });

  it('should authenticate user with valid password', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      jwt: 'valid-jwt-token',
    });

    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'correct-password',
        rememberMe: false,
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
    expect(mockLogin).toHaveBeenCalledWith('correct-password');
  });

  it('should set auth cookie with correct expiry for regular login', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      jwt: 'valid-jwt-token',
    });

    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'correct-password',
        rememberMe: false,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await POST(request);

    expect(mockSet).toHaveBeenCalledWith('auth-token', 'valid-jwt-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour in seconds
    });
  });

  it('should set auth cookie with extended expiry for remember me', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      jwt: 'valid-jwt-token',
    });

    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'correct-password',
        rememberMe: true,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await POST(request);

    expect(mockSet).toHaveBeenCalledWith('auth-token', 'valid-jwt-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    });
  });

  it('should return 401 for invalid password', async () => {
    mockLogin.mockResolvedValue({
      success: false,
      error: 'Invalid password',
    });

    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'wrong-password',
        rememberMe: false,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      error: 'Invalid password',
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('should return 400 for missing password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        rememberMe: false,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Password is required',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should return 400 for empty password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: '',
        rememberMe: false,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Password is required',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/login', {
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
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should handle auth service errors', async () => {
    // Mock console.error for this specific test to capture expected error logs
    const originalConsoleError = console.error;
    const mockConsoleError = vi.fn();
    console.error = mockConsoleError;
    
    mockLogin.mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'any-password',
        rememberMe: false,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Authentication failed',
    });
    expect(mockConsoleError).toHaveBeenCalledWith('Login API error:', expect.any(Error));
    
    // Restore console.error
    console.error = originalConsoleError;
  });

  it('should default rememberMe to false when not provided', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      jwt: 'valid-jwt-token',
    });

    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: 'correct-password',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await POST(request);

    expect(mockSet).toHaveBeenCalledWith('auth-token', 'valid-jwt-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour (default)
    });
  });
});