// ABOUTME: Tests for logout API route
// ABOUTME: Verifies cookie deletion and proper logout responses

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/logout/route';
import { cookies } from 'next/headers';

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    delete: vi.fn(),
  })),
}));

describe('POST /api/auth/logout', () => {
  const mockCookies = vi.mocked(cookies);
  const mockDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockReturnValue({ delete: mockDelete } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should delete auth cookie and return success', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: 'Logged out successfully',
    });
    expect(mockDelete).toHaveBeenCalledWith('auth-token');
  });

  it('should work even without existing auth cookie', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: 'Logged out successfully',
    });
    expect(mockDelete).toHaveBeenCalledWith('auth-token');
  });

  it('should handle cookie deletion errors gracefully', async () => {
    mockDelete.mockImplementation(() => {
      throw new Error('Cookie deletion failed');
    });

    const request = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Logout failed',
    });
  });
});