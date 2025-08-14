// ABOUTME: Tests for password reset CLI functionality
// ABOUTME: Verifies password generation, display, and auth.json updates

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { resetPassword } from '@/lib/server/password-reset';
import * as authConfig from '@/lib/server/auth-config';

// Mock auth config module
vi.mock('@/lib/server/auth-config');

describe('Password Reset', () => {
  const mockGeneratePassword = vi.mocked(authConfig.generatePassword);
  const mockHashPassword = vi.mocked(authConfig.hashPassword);
  const mockSaveAuthConfig = vi.mocked(authConfig.saveAuthConfig);
  const mockLoadAuthConfig = vi.mocked(authConfig.loadAuthConfig);

  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lace-password-reset-'));
    
    // Mock console.log to capture output
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rmdir(tempDir, { recursive: true }).catch(() => {});
    
    consoleSpy.mockRestore();
  });

  it('should generate new password and update auth config', async () => {
    const mockPassword = 'new-secure-password-123';
    const mockHash = 'hashed-password';
    const mockSalt = 'random-salt';
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockResolvedValue({ hash: mockHash, salt: mockSalt });
    mockLoadAuthConfig.mockResolvedValue({
      passwordHash: 'old-hash',
      salt: 'old-salt',
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt',
      jwtSecret: 'jwt-secret'
    });
    
    await resetPassword();
    
    expect(mockGeneratePassword).toHaveBeenCalled();
    expect(mockHashPassword).toHaveBeenCalledWith(mockPassword);
    expect(mockSaveAuthConfig).toHaveBeenCalledWith({
      passwordHash: mockHash,
      salt: mockSalt,
      iterations: 16384,
      createdAt: expect.any(String),
      algorithm: 'scrypt',
      jwtSecret: 'jwt-secret'
    });
    
    // Should display the new password
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('New password'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(mockPassword));
  });

  it('should display formatted password output', async () => {
    const mockPassword = 'test-password-456';
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockResolvedValue({ hash: 'hash', salt: 'salt' });
    mockLoadAuthConfig.mockResolvedValue({
      passwordHash: 'old-hash',
      salt: 'old-salt',
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt',
      jwtSecret: 'jwt-secret'
    });
    
    await resetPassword();
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🔐 Password Reset Complete'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('New password:'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(mockPassword));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Please save it in a secure location'));
  });

  it('should handle errors during password hashing', async () => {
    const mockPassword = 'test-password';
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockRejectedValue(new Error('Hashing failed'));
    
    await expect(resetPassword()).rejects.toThrow('Failed to reset password: Hashing failed');
    
    expect(mockSaveAuthConfig).not.toHaveBeenCalled();
  });

  it('should handle errors during config saving', async () => {
    const mockPassword = 'test-password';
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockResolvedValue({ hash: 'hash', salt: 'salt' });
    mockSaveAuthConfig.mockRejectedValue(new Error('Save failed'));
    
    await expect(resetPassword()).rejects.toThrow('Failed to reset password: Save failed');
  });

  it('should preserve existing auth config properties', async () => {
    const mockPassword = 'new-password';
    const existingConfig = {
      passwordHash: 'old-hash',
      salt: 'old-salt',
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt' as const,
      jwtSecret: 'existing-secret',
      otherProperty: 'should-be-preserved'
    };
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockResolvedValue({ hash: 'new-hash', salt: 'new-salt' });
    mockLoadAuthConfig.mockResolvedValue(existingConfig);
    mockSaveAuthConfig.mockResolvedValue();
    
    await resetPassword();
    
    expect(mockSaveAuthConfig).toHaveBeenCalledWith({
      passwordHash: 'new-hash',
      salt: 'new-salt',
      iterations: 16384,
      createdAt: expect.any(String),
      algorithm: 'scrypt',
      jwtSecret: 'existing-secret',
      otherProperty: 'should-be-preserved'
    });
  });

  it('should work when no existing config exists', async () => {
    const mockPassword = 'first-password';
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockResolvedValue({ hash: 'hash', salt: 'salt' });
    mockLoadAuthConfig.mockResolvedValue(null);
    mockSaveAuthConfig.mockResolvedValue();
    
    await resetPassword();
    
    expect(mockSaveAuthConfig).toHaveBeenCalledWith({
      passwordHash: 'hash',
      salt: 'salt',
      iterations: 16384,
      createdAt: expect.any(String),
      algorithm: 'scrypt',
      jwtSecret: expect.any(String)
    });
  });

  it('should display security warning', async () => {
    const mockPassword = 'test-password';
    
    mockGeneratePassword.mockReturnValue(mockPassword);
    mockHashPassword.mockResolvedValue({ hash: 'hash', salt: 'salt' });
    mockLoadAuthConfig.mockResolvedValue({
      passwordHash: 'old-hash',
      salt: 'old-salt',
      iterations: 16384,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt',
      jwtSecret: 'jwt-secret'
    });
    mockSaveAuthConfig.mockResolvedValue();
    
    await resetPassword();
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('⚠️  Security Notice'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('This password will be displayed only once'));
  });
});