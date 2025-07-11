// ABOUTME: Tests for FileScanner utility with .gitignore support and caching
// ABOUTME: Validates file completion, nested paths, and gitignore filtering

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from '~/interfaces/terminal/utils/file-scanner.js';

// Mock fs module
vi.mock('fs');
const mockFs = vi.mocked(fs);

describe('FileScanner', () => {
  let scanner: FileScanner;
  const testWorkingDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new FileScanner(testWorkingDir);
  });

  afterEach(() => {
    scanner.clearCache();
  });

  describe('basic file scanning', () => {
    it('should return files and directories from current directory', async () => {
      // Mock fs.existsSync to return false for .gitignore
      mockFs.existsSync.mockReturnValue(false);

      // Mock fs.readdirSync to return test files
      mockFs.readdirSync.mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
        { name: 'package.json', isDirectory: () => false, isFile: () => true } as any,
        { name: 'README.md', isDirectory: () => false, isFile: () => true } as any,
      ]);

      const completions = await scanner.getCompletions();

      expect(completions).toEqual(['src/', 'package.json', 'README.md']);
      expect(mockFs.readdirSync).toHaveBeenCalledWith(path.resolve(testWorkingDir, '.'), {
        withFileTypes: true,
      });
    });

    it('should prioritize directories over files', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        { name: 'app.ts', isDirectory: () => false, isFile: () => true } as any,
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
        { name: 'dist', isDirectory: () => true, isFile: () => false } as any,
        { name: 'index.ts', isDirectory: () => false, isFile: () => true } as any,
      ]);

      const completions = await scanner.getCompletions();

      // Directories should come first
      expect(completions.slice(0, 2)).toEqual(['dist/', 'src/']);
      expect(completions.slice(2)).toEqual(['app.ts', 'index.ts']);
    });
  });

  describe('prefix matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
        { name: 'scripts', isDirectory: () => true, isFile: () => false } as any,
        { name: 'app.ts', isDirectory: () => false, isFile: () => true } as any,
        { name: 'server.ts', isDirectory: () => false, isFile: () => true } as any,
      ]);
    });

    it('should filter by prefix match', async () => {
      const completions = await scanner.getCompletions('s');

      expect(completions).toEqual(['scripts/', 'src/', 'server.ts']);
    });

    it('should prioritize exact prefix matches', async () => {
      const completions = await scanner.getCompletions('src');

      // src/ should come before scripts/ because it's an exact prefix match
      expect(completions[0]).toBe('src/');
    });
  });

  describe('nested path completion', () => {
    it('should complete within subdirectories', async () => {
      mockFs.existsSync.mockReturnValue(false);

      // Mock different calls to readdirSync
      mockFs.readdirSync.mockImplementation((dirPath: any) => {
        if (dirPath.endsWith('src')) {
          return [
            { name: 'components', isDirectory: () => true, isFile: () => false } as any,
            { name: 'utils', isDirectory: () => true, isFile: () => false } as any,
            { name: 'app.ts', isDirectory: () => false, isFile: () => true } as any,
          ];
        }
        return [];
      });

      const completions = await scanner.getCompletions('src/');

      expect(completions).toEqual(['src/components/', 'src/utils/', 'src/app.ts']);
    });

    it('should match nested paths with partial filename', async () => {
      mockFs.existsSync.mockReturnValue(false);

      mockFs.readdirSync.mockImplementation((dirPath: any) => {
        if (dirPath.endsWith('src')) {
          return [
            { name: 'app.ts', isDirectory: () => false, isFile: () => true } as any,
            { name: 'agent.ts', isDirectory: () => false, isFile: () => true } as any,
            { name: 'utils', isDirectory: () => true, isFile: () => false } as any,
          ];
        }
        return [];
      });

      const completions = await scanner.getCompletions('src/a');

      expect(completions).toEqual(['src/agent.ts', 'src/app.ts']);
    });
  });

  describe('.gitignore support', () => {
    it('should respect .gitignore patterns', async () => {
      // Mock .gitignore exists and has content
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('node_modules\n*.log\n# comment line\n\n.env');

      mockFs.readdirSync.mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
        { name: 'node_modules', isDirectory: () => true, isFile: () => false } as any,
        { name: 'dist', isDirectory: () => true, isFile: () => false } as any,
        { name: 'app.log', isDirectory: () => false, isFile: () => true } as any,
        { name: 'package.json', isDirectory: () => false, isFile: () => true } as any,
        { name: '.env', isDirectory: () => false, isFile: () => true } as any,
      ]);

      const completions = await scanner.getCompletions();

      // Should exclude gitignored files/directories
      expect(completions).toContain('src/');
      expect(completions).toContain('package.json');
      expect(completions).toContain('dist/'); // Not in gitignore this time
      expect(completions).not.toContain('node_modules/');
      expect(completions).not.toContain('app.log');
      expect(completions).not.toContain('.env');
    });

    it('should handle missing .gitignore gracefully', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
        { name: 'node_modules', isDirectory: () => true, isFile: () => false } as any,
      ]);

      const completions = await scanner.getCompletions();

      // Should still exclude common patterns even without .gitignore
      expect(completions).toEqual(['src/']);
      expect(completions).not.toContain('node_modules/');
    });

    it('should load and parse gitignore patterns', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('*.tmp\ntest-*\n# comment\n\n');

      mockFs.readdirSync.mockReturnValue([
        { name: 'app.ts', isDirectory: () => false, isFile: () => true } as any,
      ]);

      const completions = await scanner.getCompletions();

      // Should successfully complete without errors when gitignore exists
      expect(completions).toContain('app.ts');
      expect(Array.isArray(completions)).toBe(true);
    });
  });

  describe('caching behavior', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
      ]);
    });

    it('should cache results and reuse them', async () => {
      await scanner.getCompletions();
      await scanner.getCompletions();

      // Should only call readdirSync once due to caching
      expect(mockFs.readdirSync).toHaveBeenCalledTimes(1);
    });

    it('should clear cache when requested', async () => {
      await scanner.getCompletions();
      scanner.clearCache();
      await scanner.getCompletions();

      // Should call readdirSync twice after cache clear
      expect(mockFs.readdirSync).toHaveBeenCalledTimes(2);
    });

    it('should update working directory and clear cache', () => {
      const spy = vi.spyOn(scanner, 'clearCache');
      scanner.setWorkingDirectory('/new/path');

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle permission errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const completions = await scanner.getCompletions();

      expect(completions).toEqual([]);
    });

    it('should handle .gitignore read errors', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      mockFs.readdirSync.mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
      ]);

      // Should not throw and still return results
      const completions = await scanner.getCompletions();
      expect(completions).toEqual(['src/']);
    });
  });

  describe('path normalization', () => {
    it('should handle empty partial paths', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        { name: 'file.ts', isDirectory: () => false, isFile: () => true } as any,
      ]);

      const completions = await scanner.getCompletions('');

      // Should return files when no partial path provided
      expect(completions).toContain('file.ts');
    });

    it('should handle paths with trailing slashes', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockImplementation((dirPath: any) => {
        if (dirPath.endsWith('src')) {
          return [{ name: 'app.ts', isDirectory: () => false, isFile: () => true } as any];
        }
        return [];
      });

      const completions = await scanner.getCompletions('src/');

      expect(completions).toEqual(['src/app.ts']);
    });
  });
});
