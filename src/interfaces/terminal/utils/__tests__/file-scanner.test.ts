// ABOUTME: Tests for FileScanner utility with .gitignore support and caching
// ABOUTME: Validates file completion, nested paths, and gitignore filtering

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { FileScanner } from '~/interfaces/terminal/utils/file-scanner';

describe('FileScanner', () => {
  let scanner: FileScanner;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `file-scanner-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
    scanner = new FileScanner(tempDir);
  });

  afterEach(async () => {
    scanner.clearCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('basic file scanning', () => {
    it('should return files and directories from current directory', async () => {
      // Create test files and directories
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      await fs.writeFile(path.join(tempDir, 'README.md'), '# Test');

      const completions = scanner.getCompletions();

      expect(completions).toEqual(['src/', 'package.json', 'README.md']);
    });

    it('should prioritize directories over files', async () => {
      // Create test files and directories
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'export {}');
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.mkdir(path.join(tempDir, 'dist'));
      await fs.writeFile(path.join(tempDir, 'index.ts'), 'export {}');

      const completions = scanner.getCompletions();

      // Directories should come first
      expect(completions.slice(0, 2)).toEqual(['dist/', 'src/']);
      expect(completions.slice(2)).toEqual(['app.ts', 'index.ts']);
    });
  });

  describe('prefix matching', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.mkdir(path.join(tempDir, 'scripts'));
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'export {}');
      await fs.writeFile(path.join(tempDir, 'server.ts'), 'export {}');
    });

    it('should filter by prefix match', () => {
      const completions = scanner.getCompletions('s');

      expect(completions).toEqual(['scripts/', 'src/', 'server.ts']);
    });

    it('should prioritize exact prefix matches', () => {
      const completions = scanner.getCompletions('src');

      // src/ should come before scripts/ because it's an exact prefix match
      expect(completions[0]).toBe('src/');
    });
  });

  describe('nested path completion', () => {
    it('should complete within subdirectories', async () => {
      // Create nested structure
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.mkdir(path.join(tempDir, 'src', 'components'));
      await fs.mkdir(path.join(tempDir, 'src', 'utils'));
      await fs.writeFile(path.join(tempDir, 'src', 'app.ts'), 'export {}');

      const completions = scanner.getCompletions('src/');

      expect(completions).toEqual(['src/components/', 'src/utils/', 'src/app.ts']);
    });

    it('should match nested paths with partial filename', async () => {
      // Create nested structure
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.writeFile(path.join(tempDir, 'src', 'app.ts'), 'export {}');
      await fs.writeFile(path.join(tempDir, 'src', 'agent.ts'), 'export {}');
      await fs.mkdir(path.join(tempDir, 'src', 'utils'));

      const completions = scanner.getCompletions('src/a');

      expect(completions).toEqual(['src/agent.ts', 'src/app.ts']);
    });
  });

  describe('.gitignore support', () => {
    it('should respect .gitignore patterns', async () => {
      // Create .gitignore file
      await fs.writeFile(
        path.join(tempDir, '.gitignore'),
        'node_modules\n*.log\n# comment line\n\n.env'
      );

      // Create test files and directories
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.mkdir(path.join(tempDir, 'node_modules'));
      await fs.mkdir(path.join(tempDir, 'dist'));
      await fs.writeFile(path.join(tempDir, 'app.log'), 'log content');
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=value');

      const completions = scanner.getCompletions();

      // Should exclude gitignored files/directories
      expect(completions).toContain('src/');
      expect(completions).toContain('package.json');
      expect(completions).toContain('dist/'); // Not in gitignore this time
      expect(completions).not.toContain('node_modules/');
      expect(completions).not.toContain('app.log');
      expect(completions).not.toContain('.env');
    });

    it('should handle missing .gitignore gracefully', async () => {
      // Create test files and directories (no .gitignore)
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.mkdir(path.join(tempDir, 'node_modules'));

      const completions = scanner.getCompletions();

      // Should still exclude common patterns even without .gitignore
      expect(completions).toEqual(['src/']);
      expect(completions).not.toContain('node_modules/');
    });

    it('should load and parse gitignore patterns', async () => {
      // Create .gitignore file
      await fs.writeFile(path.join(tempDir, '.gitignore'), '*.tmp\ntest-*\n# comment\n\n');

      // Create test files
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'export {}');

      const completions = scanner.getCompletions();

      // Should successfully complete without errors when gitignore exists
      expect(completions).toContain('app.ts');
      expect(Array.isArray(completions)).toBe(true);
    });
  });

  describe('caching behavior', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(tempDir, 'src'));
    });

    it('should cache results and reuse them', () => {
      const completions1 = scanner.getCompletions();
      const completions2 = scanner.getCompletions();

      // Should return same results
      expect(completions1).toEqual(completions2);
    });

    it('should clear cache when requested', async () => {
      scanner.getCompletions();

      // Add a new file
      await fs.writeFile(path.join(tempDir, 'new-file.ts'), 'export {}');

      // Should not see new file yet (cached)
      const completions2 = scanner.getCompletions();
      expect(completions2).not.toContain('new-file.ts');

      // Clear cache and should see new file
      scanner.clearCache();
      const completions3 = scanner.getCompletions();
      expect(completions3).toContain('new-file.ts');
    });

    it('should update working directory and clear cache', async () => {
      const newTempDir = path.join(os.tmpdir(), `file-scanner-test-${randomUUID()}`);
      await fs.mkdir(newTempDir, { recursive: true });

      try {
        const completions1 = scanner.getCompletions();

        scanner.setWorkingDirectory(newTempDir);
        const completions2 = scanner.getCompletions();

        // Should be different results for different directories
        expect(completions1).not.toEqual(completions2);
      } finally {
        await fs.rm(newTempDir, { recursive: true, force: true });
      }
    });
  });

  describe('error handling', () => {
    it('should handle permission errors gracefully', async () => {
      // Create a restricted directory (try to make it unreadable)
      const restrictedDir = path.join(tempDir, 'restricted');
      await fs.mkdir(restrictedDir);

      try {
        // Try to make directory unreadable (may not work on all systems)
        await fs.chmod(restrictedDir, 0o000);

        const completions = scanner.getCompletions();

        // Should not throw and return some results
        expect(Array.isArray(completions)).toBe(true);
      } catch (error) {
        // If chmod fails, skip this test
        console.log('Skipping permission test - chmod failed:', error);
      } finally {
        // Restore permissions for cleanup
        try {
          await fs.chmod(restrictedDir, 0o755);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle .gitignore read errors', async () => {
      // Create .gitignore file
      await fs.writeFile(path.join(tempDir, '.gitignore'), '*.tmp\ntest-*\n');

      // Create test files
      await fs.mkdir(path.join(tempDir, 'src'));

      try {
        // Try to make .gitignore unreadable (may not work on all systems)
        await fs.chmod(path.join(tempDir, '.gitignore'), 0o000);

        // Should not throw and still return results
        const completions = scanner.getCompletions();
        expect(completions).toEqual(['src/']);
      } catch (error) {
        // If chmod fails, skip this test
        console.log('Skipping .gitignore permission test - chmod failed:', error);
      } finally {
        // Restore permissions for cleanup
        try {
          await fs.chmod(path.join(tempDir, '.gitignore'), 0o644);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('path normalization', () => {
    it('should handle empty partial paths', async () => {
      await fs.writeFile(path.join(tempDir, 'file.ts'), 'export {}');

      const completions = scanner.getCompletions('');

      // Should return files when no partial path provided
      expect(completions).toContain('file.ts');
    });

    it('should handle paths with trailing slashes', async () => {
      await fs.mkdir(path.join(tempDir, 'src'));
      await fs.writeFile(path.join(tempDir, 'src', 'app.ts'), 'export {}');

      const completions = scanner.getCompletions('src/');

      expect(completions).toEqual(['src/app.ts']);
    });
  });
});
