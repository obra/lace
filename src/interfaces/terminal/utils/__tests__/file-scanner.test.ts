// ABOUTME: Tests for FileScanner utility with .gitignore support and caching
// ABOUTME: Validates file completion, nested paths, and gitignore filtering

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from '~/interfaces/terminal/utils/file-scanner.js';
import type { Dirent, PathLike } from 'fs';

// Mock fs module
vi.mock('fs');
const mockFs = vi.mocked(fs);

// Helper function to create mock Dirent objects
function createMockDirent(name: string, isDirectory: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: '',
    parentPath: '',
  } as Dirent<string>;
}

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
        createMockDirent('src', true),
        createMockDirent('package.json', false),
        createMockDirent('README.md', false),
      ] as any);

      const completions = await scanner.getCompletions();

      expect(completions).toEqual(['src/', 'package.json', 'README.md'] as string[]);
      expect(mockFs.readdirSync).toHaveBeenCalledWith(path.resolve(testWorkingDir, '.'), {
        withFileTypes: true,
      });
    });

    it('should prioritize directories over files', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        createMockDirent('app.ts', false),
        createMockDirent('src', true),
        createMockDirent('dist', true),
        createMockDirent('index.ts', false),
      ] as any);

      const completions = await scanner.getCompletions();

      // Directories should come first
      expect(completions.slice(0, 2)).toEqual(['dist/', 'src/'] as string[]);
      expect(completions.slice(2)).toEqual(['app.ts', 'index.ts'] as string[]);
    });
  });

  describe('prefix matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([
        createMockDirent('src', true),
        createMockDirent('scripts', true),
        createMockDirent('app.ts', false),
        createMockDirent('server.ts', false),
      ] as any);
    });

    it('should filter by prefix match', async () => {
      const completions = await scanner.getCompletions('s');

      expect(completions).toEqual(['scripts/', 'src/', 'server.ts'] as string[]);
    });

    it('should prioritize exact prefix matches', async () => {
      const completions = await scanner.getCompletions('src');

      // src/ should come before scripts/ because it's an exact prefix match
      expect(completions[0]).toBe('src/');
    });
  });

  describe('nested path completion', () => {
    it('should complete within subdirectories', () => {
      mockFs.existsSync.mockReturnValue(false);

      // Mock different calls to readdirSync
      mockFs.readdirSync.mockImplementation((dirPath: PathLike) => {
        const pathStr = typeof dirPath === 'string' ? dirPath : dirPath.toString();
        if (pathStr.endsWith('src')) {
          return [
            createMockDirent('components', true),
            createMockDirent('utils', true),
            createMockDirent('app.ts', false),
          ] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const completions = scanner.getCompletions('src/');

      expect(completions).toEqual(['src/components/', 'src/utils/', 'src/app.ts'] as string[]);
    });

    it('should match nested paths with partial filename', () => {
      mockFs.existsSync.mockReturnValue(false);

      mockFs.readdirSync.mockImplementation((dirPath: PathLike) => {
        const pathStr = typeof dirPath === 'string' ? dirPath : dirPath.toString();
        if (pathStr.endsWith('src')) {
          return [
            createMockDirent('app.ts', false),
            createMockDirent('agent.ts', false),
            createMockDirent('utils', true),
          ] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const completions = scanner.getCompletions('src/a');

      expect(completions).toEqual(['src/agent.ts', 'src/app.ts'] as string[]);
    });
  });

  describe('.gitignore support', () => {
    it('should respect .gitignore patterns', async () => {
      // Mock .gitignore exists and has content
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('node_modules\n*.log\n# comment line\n\n.env');

      mockFs.readdirSync.mockReturnValue([
        createMockDirent('src', true),
        createMockDirent('node_modules', true),
        createMockDirent('dist', true),
        createMockDirent('app.log', false),
        createMockDirent('package.json', false),
        createMockDirent('.env', false),
      ] as any);

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
        createMockDirent('src', true),
        createMockDirent('node_modules', true),
      ] as any);

      const completions = await scanner.getCompletions();

      // Should still exclude common patterns even without .gitignore
      expect(completions).toEqual(['src/'] as string[]);
      expect(completions).not.toContain('node_modules/');
    });

    it('should load and parse gitignore patterns', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('*.tmp\ntest-*\n# comment\n\n');

      mockFs.readdirSync.mockReturnValue([createMockDirent('app.ts', false)] as any);

      const completions = await scanner.getCompletions();

      // Should successfully complete without errors when gitignore exists
      expect(completions).toContain('app.ts');
      expect(Array.isArray(completions)).toBe(true);
    });
  });

  describe('caching behavior', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([createMockDirent('src', true)] as any);
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

      expect(completions).toEqual([] as string[]);
    });

    it('should handle .gitignore read errors', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      mockFs.readdirSync.mockReturnValue([createMockDirent('src', true)] as any);

      // Should not throw and still return results
      const completions = await scanner.getCompletions();
      expect(completions).toEqual(['src/'] as string[]);
    });
  });

  describe('path normalization', () => {
    it('should handle empty partial paths', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([createMockDirent('file.ts', false)] as any);

      const completions = await scanner.getCompletions('');

      // Should return files when no partial path provided
      expect(completions).toContain('file.ts');
    });

    it('should handle paths with trailing slashes', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockImplementation((dirPath: PathLike) => {
        const pathStr = typeof dirPath === 'string' ? dirPath : dirPath.toString();
        if (pathStr.endsWith('src')) {
          return [createMockDirent('app.ts', false)] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      const completions = scanner.getCompletions('src/');

      expect(completions).toEqual(['src/app.ts'] as string[]);
    });
  });
});
