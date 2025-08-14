// ABOUTME: Tests for logout all sessions API route
// ABOUTME: Verifies JWT secret regeneration and session invalidation

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { POST } from '@/app/api/auth/logout-all/route';
import { clearJWTSecretCache, loadAuthConfig } from '@/lib/server/auth-config';

// Mock api-auth module to bypass authentication
vi.mock('@/lib/server/api-auth', () => ({
  requireAuth: vi.fn(() => null), // Default to authenticated
}));

describe('POST /api/auth/logout-all', () => {
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
    const { hash, salt } = await hashPassword('testpass123');
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

  it('should invalidate all sessions successfully', async () => {
    // Get initial JWT secret
    const initialConfig = await loadAuthConfig();
    const initialJWTSecret = initialConfig?.jwtSecret;

    const request = new NextRequest('http://localhost:3000/api/auth/logout-all', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: 'All sessions terminated successfully',
    });

    // Verify JWT secret was changed
    const updatedConfig = await loadAuthConfig();
    const updatedJWTSecret = updatedConfig?.jwtSecret;
    
    expect(updatedJWTSecret).toBeTruthy();
    expect(updatedJWTSecret).not.toEqual(initialJWTSecret);
  });
});