// ABOUTME: Tests for Lace configuration directory management
// ABOUTME: Tests environment variable handling, directory creation, and path utilities

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import {
  getLaceDir,
  ensureLaceDir,
  getLaceFilePath,
  getLaceDbPath,
  getProcessTempDir,
  clearProcessTempDirCache,
} from '~/config/lace-dir';

describe('Lace Directory Management', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-dir-test-'));

    // Save original LACE_DIR and set to temp directory
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    // Restore original LACE_DIR
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getLaceDir', () => {
    it('should return LACE_DIR environment variable when set', () => {
      const result = getLaceDir();
      expect(result).toBe(tempDir);
    });

    it('should return ~/.lace when LACE_DIR is not set', () => {
      delete process.env.LACE_DIR;

      const result = getLaceDir();
      const expectedPath = path.join(os.homedir(), '.lace');

      expect(result).toBe(expectedPath);
    });

    it('should handle empty LACE_DIR environment variable', () => {
      process.env.LACE_DIR = '';

      const result = getLaceDir();
      const expectedPath = path.join(os.homedir(), '.lace');

      expect(result).toBe(expectedPath);
    });
  });

  describe('ensureLaceDir', () => {
    it('should return existing directory path when directory exists', () => {
      // Directory already exists from beforeEach
      expect(fs.existsSync(tempDir)).toBe(true);

      const result = ensureLaceDir();

      expect(result).toBe(tempDir);
      expect(fs.existsSync(tempDir)).toBe(true);
    });

    it('should create directory when it does not exist', () => {
      const newTempDir = path.join(tempDir, 'new-lace-dir');
      process.env.LACE_DIR = newTempDir;

      expect(fs.existsSync(newTempDir)).toBe(false);

      const result = ensureLaceDir();

      expect(result).toBe(newTempDir);
      expect(fs.existsSync(newTempDir)).toBe(true);
    });

    it('should create nested directories recursively', () => {
      const nestedDir = path.join(tempDir, 'nested', 'deeply', 'lace-dir');
      process.env.LACE_DIR = nestedDir;

      expect(fs.existsSync(nestedDir)).toBe(false);

      const result = ensureLaceDir();

      expect(result).toBe(nestedDir);
      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('should throw meaningful error when directory creation fails', () => {
      // Try to create a directory inside a file (should fail)
      const filePath = path.join(tempDir, 'blocking-file.txt');
      const invalidDirPath = path.join(filePath, 'cannot-create-here');

      fs.writeFileSync(filePath, 'content');
      process.env.LACE_DIR = invalidDirPath;

      expect(() => ensureLaceDir()).toThrow(/Failed to create Lace configuration directory/);
      expect(() => ensureLaceDir()).toThrow(invalidDirPath);
    });

    it('should handle permission errors gracefully', () => {
      const readonlyParent = path.join(tempDir, 'readonly-parent');
      const targetDir = path.join(readonlyParent, 'target');

      fs.mkdirSync(readonlyParent);
      fs.chmodSync(readonlyParent, 0o444); // Read-only

      process.env.LACE_DIR = targetDir;

      try {
        expect(() => ensureLaceDir()).toThrow(/Failed to create Lace configuration directory/);
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(readonlyParent, 0o755);
      }
    });
  });

  describe('getLaceFilePath', () => {
    it('should return correct path for given filename', () => {
      const filename = 'test-file.txt';
      const result = getLaceFilePath(filename);
      const expected = path.join(tempDir, filename);

      expect(result).toBe(expected);
    });

    it('should handle filenames with extensions', () => {
      const filename = 'config.json';
      const result = getLaceFilePath(filename);
      const expected = path.join(tempDir, filename);

      expect(result).toBe(expected);
    });

    it('should handle subdirectory paths', () => {
      const filename = path.join('subdir', 'file.txt');
      const result = getLaceFilePath(filename);
      const expected = path.join(tempDir, 'subdir', 'file.txt');

      expect(result).toBe(expected);
    });

    it('should work with different LACE_DIR values', () => {
      const customDir = path.join(tempDir, 'custom');
      process.env.LACE_DIR = customDir;

      const filename = 'test.dat';
      const result = getLaceFilePath(filename);
      const expected = path.join(customDir, filename);

      expect(result).toBe(expected);
    });

    it('should use default ~/.lace when LACE_DIR is not set', () => {
      delete process.env.LACE_DIR;

      const filename = 'test.txt';
      const result = getLaceFilePath(filename);
      const expected = path.join(os.homedir(), '.lace', filename);

      expect(result).toBe(expected);
    });
  });

  describe('getLaceDbPath', () => {
    it('should return lace.db in the lace directory', () => {
      const result = getLaceDbPath();
      const expected = path.join(tempDir, 'lace.db');

      expect(result).toBe(expected);
    });

    it('should work with custom LACE_DIR', () => {
      const customDir = path.join(tempDir, 'custom-lace');
      process.env.LACE_DIR = customDir;

      const result = getLaceDbPath();
      const expected = path.join(customDir, 'lace.db');

      expect(result).toBe(expected);
    });

    it('should use default ~/.lace when LACE_DIR is not set', () => {
      delete process.env.LACE_DIR;

      const result = getLaceDbPath();
      const expected = path.join(os.homedir(), '.lace', 'lace.db');

      expect(result).toBe(expected);
    });
  });

  describe('integration tests', () => {
    it('should work together for full workflow', () => {
      const customDir = path.join(tempDir, 'integration-test');
      process.env.LACE_DIR = customDir;

      // Verify directory doesn't exist initially
      expect(fs.existsSync(customDir)).toBe(false);

      // Get directory path
      const dirPath = getLaceDir();
      expect(dirPath).toBe(customDir);

      // Ensure directory exists
      const ensuredPath = ensureLaceDir();
      expect(ensuredPath).toBe(customDir);
      expect(fs.existsSync(customDir)).toBe(true);

      // Get file paths
      const configPath = getLaceFilePath('config.json');
      expect(configPath).toBe(path.join(customDir, 'config.json'));

      const dbPath = getLaceDbPath();
      expect(dbPath).toBe(path.join(customDir, 'lace.db'));
    });

    it('should handle multiple calls consistently', () => {
      const dir1 = getLaceDir();
      const dir2 = getLaceDir();
      expect(dir1).toBe(dir2);

      const ensured1 = ensureLaceDir();
      const ensured2 = ensureLaceDir();
      expect(ensured1).toBe(ensured2);

      const file1 = getLaceFilePath('test.txt');
      const file2 = getLaceFilePath('test.txt');
      expect(file1).toBe(file2);

      const db1 = getLaceDbPath();
      const db2 = getLaceDbPath();
      expect(db1).toBe(db2);
    });
  });

  describe('edge cases', () => {
    it('should handle very long directory paths', () => {
      const longPath = path.join(tempDir, 'a'.repeat(50), 'b'.repeat(50));
      process.env.LACE_DIR = longPath;

      expect(() => {
        const dir = getLaceDir();
        expect(dir).toBe(longPath);

        const ensuredDir = ensureLaceDir();
        expect(ensuredDir).toBe(longPath);
        expect(fs.existsSync(longPath)).toBe(true);
      }).not.toThrow();
    });

    it('should handle special characters in paths', () => {
      const specialPath = path.join(tempDir, 'test-dir', 'special chars & symbols');
      process.env.LACE_DIR = specialPath;

      const dir = getLaceDir();
      expect(dir).toBe(specialPath);

      const ensuredDir = ensureLaceDir();
      expect(ensuredDir).toBe(specialPath);
      expect(fs.existsSync(specialPath)).toBe(true);
    });
  });

  describe('process temp directory', () => {
    afterEach(() => {
      // Clean up for next test
      clearProcessTempDirCache();
    });

    it('should create a process temp directory', () => {
      const tempDir = getProcessTempDir();

      expect(tempDir).toMatch(/^.*lace-runtime-\d+-\d+-[a-zA-Z0-9]+$/);
      expect(fs.existsSync(tempDir)).toBe(true);
    });

    it('should return the same directory on multiple calls', () => {
      const tempDir1 = getProcessTempDir();
      const tempDir2 = getProcessTempDir();

      expect(tempDir1).toBe(tempDir2);
    });

    it('should create different directories after cache clear', () => {
      const tempDir1 = getProcessTempDir();
      clearProcessTempDirCache();
      const tempDir2 = getProcessTempDir();

      expect(tempDir1).not.toBe(tempDir2);
    });

    it('should create directory under system tmpdir', () => {
      const tempDir = getProcessTempDir();
      const systemTmpDir = os.tmpdir();

      expect(tempDir).toContain(systemTmpDir);
    });
  });
});
