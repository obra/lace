// ABOUTME: Tests for environment variable loading functionality

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadEnvFile } from './env-loader.js';

describe('loadEnvFile', () => {
  const testDir = path.join(process.cwd(), 'test-env-temp');
  const envPath = path.join(testDir, '.env');
  const envLocalPath = path.join(testDir, '.env.local');
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
    
    // Clean up any existing env vars from previous tests
    delete process.env.TEST_VAR;
    delete process.env.TEST_VAR_2;
    delete process.env.OVERRIDE_VAR;
  });

  afterEach(() => {
    // Clean up test directory
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    
    // Clean up env vars
    delete process.env.TEST_VAR;
    delete process.env.TEST_VAR_2;
    delete process.env.OVERRIDE_VAR;
  });

  it('should load .env file when only .env exists', () => {
    fs.writeFileSync(envPath, 'TEST_VAR=from_env\n');
    
    loadEnvFile();
    
    expect(process.env.TEST_VAR).toBe('from_env');
  });

  it('should load .env.local file when only .env.local exists', () => {
    fs.writeFileSync(envLocalPath, 'TEST_VAR=from_env_local\n');
    
    loadEnvFile();
    
    expect(process.env.TEST_VAR).toBe('from_env_local');
  });

  it('should load both files with .env.local taking precedence', () => {
    fs.writeFileSync(envPath, 'TEST_VAR=from_env\nTEST_VAR_2=only_in_env\n');
    fs.writeFileSync(envLocalPath, 'TEST_VAR=from_env_local\nOVERRIDE_VAR=from_local\n');
    
    loadEnvFile();
    
    expect(process.env.TEST_VAR).toBe('from_env_local'); // overridden
    expect(process.env.TEST_VAR_2).toBe('only_in_env'); // from .env
    expect(process.env.OVERRIDE_VAR).toBe('from_local'); // from .env.local
  });

  it('should work when neither file exists', () => {
    // No files created
    
    expect(() => loadEnvFile()).not.toThrow();
    expect(process.env.TEST_VAR).toBeUndefined();
  });

  it('should handle malformed .env files gracefully', () => {
    fs.writeFileSync(envPath, 'VALID_VAR=value\nINVALID LINE WITHOUT EQUALS\n');
    
    expect(() => loadEnvFile()).not.toThrow();
    expect(process.env.VALID_VAR).toBe('value');
  });
});