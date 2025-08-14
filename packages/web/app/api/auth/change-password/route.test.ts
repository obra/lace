// ABOUTME: Tests for password change API route
// ABOUTME: Verifies password verification, hashing, and config updates

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { POST } from '@/app/api/auth/change-password/route';
import { clearJWTSecretCache } from '@/lib/server/auth-config';

// Mock api-auth module to bypass authentication
vi.mock('@/lib/server/api-auth', () => ({
  requireAuth: vi.fn(() => null), // Default to authenticated
}));

describe('POST /api/auth/change-password', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'lace-auth-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    
    // Clear JWT secret cache to ensure clean state
    clearJWTSecretCache();
    
    // Initialize auth with a known password for testing
    const { hashPassword, saveAuthConfig } = await import('@/lib/server/auth-config');
    const { hash, salt } = await hashPassword('current123');
    const jwtSecret = 'test-jwt-secret';
    
    const config = {
      passwordHash: hash,
      salt,
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt' as const,
      jwtSecret
    };
    
    await saveAuthConfig(config);
    
    
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should change password with valid current password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'current123',
        newPassword: 'newpass456',
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
      message: 'Password changed successfully',
    });
  });

  it('should return 401 for incorrect current password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'wrong123',
        newPassword: 'newpass456',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      error: 'Current password is incorrect',
    });
  });

  it('should return 400 for missing current password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        newPassword: 'newpass456',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Current password and new password are required',
    });
  });

  it('should return 400 for missing new password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'current123',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Current password and new password are required',
    });
  });

  it('should return 400 for empty passwords', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: '',
        newPassword: '',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Current password and new password are required',
    });
  });

  it('should return 400 for short new password', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'current123',
        newPassword: 'short',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'New password must be at least 8 characters',
    });
  });

  it('should return 400 for invalid JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/change-password', {
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
  });

  it('should update password and allow login with new password', async () => {
    // Change password from 'current123' to 'newpass456'
    const changeRequest = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'current123',
        newPassword: 'newpass456',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const changeResponse = await POST(changeRequest);
    expect(changeResponse.status).toBe(200);

    // Verify we can't use old password anymore
    const oldPasswordRequest = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'current123',
        newPassword: 'another456',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const oldPasswordResponse = await POST(oldPasswordRequest);
    expect(oldPasswordResponse.status).toBe(401);

    // Verify we can use new password
    const newPasswordRequest = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'newpass456',
        newPassword: 'final789password',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const newPasswordResponse = await POST(newPasswordRequest);
    expect(newPasswordResponse.status).toBe(200);
  });
});