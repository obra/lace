// ABOUTME: Tests for environment variable loading with .env file hierarchy support
// ABOUTME: Tests both single file loading and multi-file hierarchy loading with proper priority

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadEnvFile, loadEnvFiles, getEnvVar, requireEnvVar } from '~/config/env-loader.js';

describe('Environment Variable Loading', () => {
  let tempDir: string;
  let originalEnvVars: Record<string, string | undefined>;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-test-'));

    // Save original environment variables
    originalEnvVars = {
      NODE_ENV: process.env.NODE_ENV,
      TEST_VAR: process.env.TEST_VAR,
      PRIORITY_VAR: process.env.PRIORITY_VAR,
      ANTHROPIC_KEY: process.env.ANTHROPIC_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };

    // Clear test environment variables
    delete process.env.TEST_VAR;
    delete process.env.PRIORITY_VAR;
    delete process.env.ANTHROPIC_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Restore original environment variables
    for (const [key, value] of Object.entries(originalEnvVars)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }

    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadEnvFile (existing legacy function)', () => {
    it('should load .env file when it exists', () => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'TEST_VAR=legacy_value\nANTHROPIC_KEY=test_key');

      // Change to temp directory
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        loadEnvFile();
        expect(process.env.TEST_VAR).toBe('legacy_value');
        expect(process.env.ANTHROPIC_KEY).toBe('test_key');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should not throw when .env file does not exist', () => {
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        expect(() => loadEnvFile()).not.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle malformed .env files gracefully', () => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'VALID_VAR=value\nINVALID_LINE_WITHOUT_EQUALS\nANOTHER_VAR=another_value');

      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        expect(() => loadEnvFile()).not.toThrow();
        expect(process.env.VALID_VAR).toBe('value');
        expect(process.env.ANOTHER_VAR).toBe('another_value');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('loadEnvFiles (new hierarchy function)', () => {
    it('should load .env file when only .env exists', () => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'TEST_VAR=base_value\nANTHROPIC_KEY=base_key');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env']);
      expect(result.failed).toEqual([]);
      expect(result.variableCount).toBe(2);
      expect(process.env.TEST_VAR).toBe('base_value');
      expect(process.env.ANTHROPIC_KEY).toBe('base_key');
    });

    it('should load .env.local with higher priority than .env', () => {
      const envPath = path.join(tempDir, '.env');
      const envLocalPath = path.join(tempDir, '.env.local');

      fs.writeFileSync(envPath, 'TEST_VAR=base_value\nBASE_ONLY=base_only');
      fs.writeFileSync(envLocalPath, 'TEST_VAR=local_value\nLOCAL_ONLY=local_only');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env', '.env.local']);
      expect(result.failed).toEqual([]);
      expect(result.variableCount).toBe(4);
      expect(process.env.TEST_VAR).toBe('local_value'); // local overrides base
      expect(process.env.BASE_ONLY).toBe('base_only');
      expect(process.env.LOCAL_ONLY).toBe('local_only');
    });

    it('should load environment-specific files with correct priority', () => {
      process.env.NODE_ENV = 'development';

      const envPath = path.join(tempDir, '.env');
      const envDevPath = path.join(tempDir, '.env.development');
      const envLocalPath = path.join(tempDir, '.env.local');
      const envDevLocalPath = path.join(tempDir, '.env.development.local');

      fs.writeFileSync(envPath, 'PRIORITY_VAR=base\nBASE_VAR=base');
      fs.writeFileSync(envDevPath, 'PRIORITY_VAR=dev\nDEV_VAR=dev');
      fs.writeFileSync(envLocalPath, 'PRIORITY_VAR=local\nLOCAL_VAR=local');
      fs.writeFileSync(envDevLocalPath, 'PRIORITY_VAR=dev_local\nDEV_LOCAL_VAR=dev_local');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env', '.env.development', '.env.local', '.env.development.local']);
      expect(result.failed).toEqual([]);
      expect(result.variableCount).toBe(6);
      expect(process.env.PRIORITY_VAR).toBe('dev_local'); // highest priority
      expect(process.env.BASE_VAR).toBe('base');
      expect(process.env.DEV_VAR).toBe('dev');
      expect(process.env.LOCAL_VAR).toBe('local');
      expect(process.env.DEV_LOCAL_VAR).toBe('dev_local');
    });

    it('should skip missing files without errors', () => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'TEST_VAR=only_base');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env']);
      expect(result.failed).toEqual([]);
      expect(result.variableCount).toBe(1);
      expect(process.env.TEST_VAR).toBe('only_base');
    });

    it('should handle malformed files gracefully', () => {
      const envPath = path.join(tempDir, '.env');
      const envLocalPath = path.join(tempDir, '.env.local');

      fs.writeFileSync(envPath, 'VALID_VAR=valid_value');
      fs.writeFileSync(envLocalPath, 'MALFORMED_CONTENT_WITHOUT_EQUALS\nVALID_VAR2=valid_value2');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toContain('.env');
      expect(result.failed).toContain('.env.local');
      expect(process.env.VALID_VAR).toBe('valid_value');
      expect(process.env.VALID_VAR2).toBeUndefined();
    });

    it('should use current working directory when no rootDir provided', () => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'TEST_VAR=cwd_value');

      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        const result = loadEnvFiles();
        expect(result.loaded).toEqual(['.env']);
        expect(process.env.TEST_VAR).toBe('cwd_value');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle different NODE_ENV values', () => {
      process.env.NODE_ENV = 'production';

      const envPath = path.join(tempDir, '.env');
      const envProdPath = path.join(tempDir, '.env.production');

      fs.writeFileSync(envPath, 'TEST_VAR=base_value');
      fs.writeFileSync(envProdPath, 'TEST_VAR=prod_value\nPROD_VAR=prod_only');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env', '.env.production']);
      expect(process.env.TEST_VAR).toBe('prod_value');
      expect(process.env.PROD_VAR).toBe('prod_only');
    });

    it('should default to development when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;

      const envPath = path.join(tempDir, '.env');
      const envDevPath = path.join(tempDir, '.env.development');

      fs.writeFileSync(envPath, 'TEST_VAR=base_value');
      fs.writeFileSync(envDevPath, 'TEST_VAR=dev_value');

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env', '.env.development']);
      expect(process.env.TEST_VAR).toBe('dev_value');
    });

    it('should return detailed results', () => {
      const envPath = path.join(tempDir, '.env');
      const envLocalPath = path.join(tempDir, '.env.local');

      fs.writeFileSync(envPath, 'VAR1=value1\nVAR2=value2');
      fs.writeFileSync(envLocalPath, 'VAR3=value3');

      const result = loadEnvFiles(tempDir);

      expect(result).toEqual({
        loaded: ['.env', '.env.local'],
        failed: [],
        variableCount: 3
      });
    });
  });

  describe('getEnvVar', () => {
    it('should return environment variable value when set', () => {
      process.env.TEST_VAR = 'test_value';
      expect(getEnvVar('TEST_VAR')).toBe('test_value');
    });

    it('should return default value when environment variable is not set', () => {
      expect(getEnvVar('NONEXISTENT_VAR', 'default_value')).toBe('default_value');
    });

    it('should return undefined when environment variable is not set and no default', () => {
      expect(getEnvVar('NONEXISTENT_VAR')).toBeUndefined();
    });

    it('should return empty string when environment variable is empty', () => {
      process.env.TEST_VAR = '';
      expect(getEnvVar('TEST_VAR')).toBe('');
    });

    it('should prefer environment variable over default', () => {
      process.env.TEST_VAR = 'env_value';
      expect(getEnvVar('TEST_VAR', 'default_value')).toBe('env_value');
    });
  });

  describe('requireEnvVar', () => {
    it('should return environment variable value when set', () => {
      process.env.TEST_VAR = 'test_value';
      expect(requireEnvVar('TEST_VAR')).toBe('test_value');
    });

    it('should throw error when environment variable is not set', () => {
      expect(() => requireEnvVar('NONEXISTENT_VAR')).toThrow(
        'Required environment variable NONEXISTENT_VAR is not set'
      );
    });

    it('should throw error when environment variable is empty', () => {
      process.env.TEST_VAR = '';
      expect(() => requireEnvVar('TEST_VAR')).toThrow(
        'Required environment variable TEST_VAR is not set'
      );
    });

    it('should return whitespace-only values', () => {
      process.env.TEST_VAR = '   ';
      expect(requireEnvVar('TEST_VAR')).toBe('   ');
    });
  });

  describe('integration with real .env files', () => {
    it('should work with complex .env file scenarios', () => {
      process.env.NODE_ENV = 'test';

      const envPath = path.join(tempDir, '.env');
      const envTestPath = path.join(tempDir, '.env.test');
      const envLocalPath = path.join(tempDir, '.env.local');

      // Base configuration
      fs.writeFileSync(envPath, [
        '# Base configuration',
        'APP_NAME=lace',
        'LOG_LEVEL=info',
        'DATABASE_URL=sqlite:///tmp/base.db',
        'API_TIMEOUT=30000',
        '',
        '# Provider configurations',
        'ANTHROPIC_KEY=base_anthropic_key',
        'OPENAI_API_KEY=base_openai_key',
      ].join('\n'));

      // Test environment overrides
      fs.writeFileSync(envTestPath, [
        '# Test environment overrides',
        'LOG_LEVEL=debug',
        'DATABASE_URL=sqlite:///:memory:',
        'API_TIMEOUT=5000',
        'TEST_MODE=true',
      ].join('\n'));

      // Local developer overrides
      fs.writeFileSync(envLocalPath, [
        '# Local developer overrides',
        'ANTHROPIC_KEY=local_anthropic_key',
        'DEVELOPER_MODE=true',
        'LOG_LEVEL=trace',
      ].join('\n'));

      const result = loadEnvFiles(tempDir);

      expect(result.loaded).toEqual(['.env', '.env.test', '.env.local']);
      expect(result.failed).toEqual([]);

      // Verify priority order
      expect(process.env.APP_NAME).toBe('lace'); // Only in base
      expect(process.env.LOG_LEVEL).toBe('trace'); // Overridden by local
      expect(process.env.DATABASE_URL).toBe('sqlite:///:memory:'); // Overridden by test
      expect(process.env.API_TIMEOUT).toBe('5000'); // Overridden by test
      expect(process.env.TEST_MODE).toBe('true'); // Only in test
      expect(process.env.DEVELOPER_MODE).toBe('true'); // Only in local
      expect(process.env.ANTHROPIC_KEY).toBe('local_anthropic_key'); // Overridden by local
      expect(process.env.OPENAI_API_KEY).toBe('base_openai_key'); // Only in base

      // Verify utility functions work with loaded values
      expect(getEnvVar('APP_NAME')).toBe('lace');
      expect(getEnvVar('LOG_LEVEL')).toBe('trace');
      expect(requireEnvVar('ANTHROPIC_KEY')).toBe('local_anthropic_key');
      expect(getEnvVar('NONEXISTENT', 'default')).toBe('default');
    });
  });
});