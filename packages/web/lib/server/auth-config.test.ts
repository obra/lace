// ABOUTME: Tests for authentication configuration and password management
// ABOUTME: Verifies secure password generation, hashing, and verification

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import {
  generatePassword,
  hashPassword,
  verifyPassword,
  loadAuthConfig,
  saveAuthConfig,
  initializeAuth,
  resetPassword,
  getOrInitializeAuth,
  getOrGenerateJWTSecret,
  clearJWTSecretCache,
  type AuthConfig
} from '@/lib/server/auth-config';

describe('Auth Configuration', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'lace-auth-test-'));
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

  describe('generatePassword', () => {
    it('should generate a password of reasonable length', () => {
      const password = generatePassword();
      expect(password).toBeTruthy();
      expect(password.length).toBeGreaterThanOrEqual(20);
      expect(password.length).toBeLessThanOrEqual(30);
    });

    it('should generate unique passwords', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 10; i++) {
        passwords.add(generatePassword());
      }
      expect(passwords.size).toBe(10);
    });
  });

  describe('hashPassword and verifyPassword', () => {
    it('should hash and verify a password correctly', async () => {
      const password = 'test-password-123';
      const { hash, salt } = await hashPassword(password);
      
      expect(hash).toBeTruthy();
      expect(salt).toBeTruthy();
      expect(hash).not.toBe(password);
      
      const isValid = await verifyPassword(password, hash, salt);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'correct-password';
      const { hash, salt } = await hashPassword(password);
      
      const isValid = await verifyPassword('wrong-password', hash, salt);
      expect(isValid).toBe(false);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'same-password';
      const result1 = await hashPassword(password);
      const result2 = await hashPassword(password);
      
      expect(result1.hash).not.toBe(result2.hash);
      expect(result1.salt).not.toBe(result2.salt);
    });
  });

  describe('loadAuthConfig and saveAuthConfig', () => {
    it('should return null when no config exists', () => {
      const config = loadAuthConfig();
      expect(config).toBeNull();
    });

    it('should save and load auth config', async () => {
      const config: AuthConfig = {
        passwordHash: 'test-hash',
        salt: 'test-salt',
        iterations: 32768,
        createdAt: new Date().toISOString(),
        algorithm: 'scrypt',
        jwtSecret: 'test-jwt-secret'
      };
      
      saveAuthConfig(config);
      
      const loaded = loadAuthConfig();
      expect(loaded).toEqual(config);
    });

    it('should create auth.json with restrictive permissions', () => {
      const config: AuthConfig = {
        passwordHash: 'test-hash',
        salt: 'test-salt',
        iterations: 32768,
        createdAt: new Date().toISOString(),
        algorithm: 'scrypt',
        jwtSecret: 'test-jwt-secret'
      };
      
      saveAuthConfig(config);
      
      const authPath = path.join(tempDir, 'auth.json');
      const stats = fs.statSync(authPath);
      // Check that only owner can read/write (0600)
      const mode = stats.mode & parseInt('777', 8);
      expect(mode).toBe(parseInt('600', 8));
    });
  });

  describe('initializeAuth', () => {
    it('should generate password and save config', async () => {
      const password = await initializeAuth();
      
      expect(password).toBeTruthy();
      expect(password.length).toBeGreaterThanOrEqual(20);
      
      const config = loadAuthConfig();
      expect(config).not.toBeNull();
      expect(config?.algorithm).toBe('scrypt');
      expect(config?.passwordHash).toBeTruthy();
      expect(config?.salt).toBeTruthy();
      expect(config?.jwtSecret).toBeTruthy();
      
      // Verify the generated password works
      const isValid = await verifyPassword(
        password,
        config!.passwordHash,
        config!.salt
      );
      expect(isValid).toBe(true);
    });
  });

  describe('resetPassword', () => {
    it('should generate new password and update config', async () => {
      // Initialize first
      const oldPassword = await initializeAuth();
      const oldConfig = loadAuthConfig();
      
      // Reset
      const newPassword = await resetPassword();
      const newConfig = loadAuthConfig();
      
      expect(newPassword).not.toBe(oldPassword);
      expect(newConfig?.passwordHash).not.toBe(oldConfig?.passwordHash);
      expect(newConfig?.salt).not.toBe(oldConfig?.salt);
      
      // Old password should not work
      const oldValid = await verifyPassword(
        oldPassword,
        newConfig!.passwordHash,
        newConfig!.salt
      );
      expect(oldValid).toBe(false);
      
      // New password should work
      const newValid = await verifyPassword(
        newPassword,
        newConfig!.passwordHash,
        newConfig!.salt
      );
      expect(newValid).toBe(true);
    });
  });

  describe('getOrInitializeAuth', () => {
    it('should return existing config without password', async () => {
      // Create existing config
      await initializeAuth();
      
      const { config, password } = await getOrInitializeAuth();
      
      expect(config).not.toBeNull();
      expect(password).toBeUndefined();
    });

    it('should initialize and return password on first run', async () => {
      const { config, password } = await getOrInitializeAuth();
      
      expect(config).not.toBeNull();
      expect(password).toBeTruthy();
      expect(password!.length).toBeGreaterThanOrEqual(20);
      
      // Verify password works
      const isValid = await verifyPassword(
        password!,
        config.passwordHash,
        config.salt
      );
      expect(isValid).toBe(true);
    });
  });

  describe('getOrGenerateJWTSecret', () => {
    it('should generate JWT secret on first call', () => {
      const secret = getOrGenerateJWTSecret();
      expect(secret).toBeTruthy();
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });

    it('should return same secret on subsequent calls', () => {
      const secret1 = getOrGenerateJWTSecret();
      const secret2 = getOrGenerateJWTSecret();
      expect(secret1).toBe(secret2);
    });

    it('should persist JWT secret in config', async () => {
      await initializeAuth();
      const secret = getOrGenerateJWTSecret();
      
      const config = loadAuthConfig();
      expect(config?.jwtSecret).toBe(secret);
    });
  });
});