// ABOUTME: Jest tests for FilesAndDirectoriesCompletionProvider fuzzy completion functionality  
// ABOUTME: Tests recursive filesystem search, gitignore filtering, and explicit path handling

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as path from 'path';
import type { Stats, Dirent } from 'fs';

// Mock fs module for ESM following established pattern
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  promises: {
    readdir: jest.fn(),
    stat: jest.fn()
  }
}));

// Import after mocking
const { FilesAndDirectoriesCompletionProvider } = await import('../../../src/ui/completion/FilesAndDirectoriesCompletionProvider.js');
const fs = await import('fs');

// Properly typed mocked fs - tell TypeScript these are mocked functions
const mockedFs = {
  existsSync: fs.existsSync as jest.MockedFunction<typeof fs.existsSync>,
  statSync: fs.statSync as jest.MockedFunction<typeof fs.statSync>,
  promises: {
    readdir: fs.promises.readdir as jest.MockedFunction<any>,
    stat: fs.promises.stat as jest.MockedFunction<typeof fs.promises.stat>
  }
};

describe('FilesAndDirectoriesCompletionProvider Enhanced', () => {
  let provider: InstanceType<typeof FilesAndDirectoriesCompletionProvider>;
  const testCwd = '/test/project';

  // Helper to create properly typed Dirent mocks
  const createMockDirent = (name: string, isDirectory: boolean): Dirent => ({
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false
  } as Dirent);

  // Helper to create properly typed Stats mocks
  const createMockStats = (isDirectory: boolean): Stats => ({
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    size: 1024,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date()
  } as Stats);

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new FilesAndDirectoriesCompletionProvider({
      cwd: testCwd,
      maxItems: 20,
      showHidden: false
    });

    // Set up default mock behavior using properly typed mocks
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(createMockStats(false));
    mockedFs.promises.stat.mockResolvedValue(createMockStats(false));
  });

  describe('Context Handling', () => {
    it('should handle non-command contexts', () => {
      const commandContext = {
        line: '/help',
        column: 5,
        lineNumber: 0,
        fullText: '/help',
        cwd: testCwd
      };

      const fileContext = {
        line: 'some file.txt',
        column: 9,
        lineNumber: 0,
        fullText: 'some file.txt',
        cwd: testCwd
      };

      expect(provider.canHandle(commandContext)).toBe(false);
      expect(provider.canHandle(fileContext)).toBe(true);
    });

    it('should handle multiline contexts', () => {
      const multilineContext = {
        line: 'edit some file',
        column: 14,
        lineNumber: 1,
        fullText: 'first line\nedit some file',
        cwd: testCwd
      };

      expect(provider.canHandle(multilineContext)).toBe(true);
    });
  });

  describe('Basic Completion Functionality', () => {
    it('should return completions for file patterns', async () => {
      const mockEntries = [
        createMockDirent('file1.txt', false),
        createMockDirent('file2.js', false),
        createMockDirent('subdir', true)
      ];
      
      mockedFs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('file');
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe('file');
      
      // Should find matching files
      const file1 = result.items.find(item => item.value.includes('file1.txt'));
      expect(file1).toBeDefined();
      expect(file1?.type).toBe('file');
    });

    it('should add trailing slash to directories', async () => {
      const mockEntries = [
        createMockDirent('mydir', true)
      ];
      
      // Mock readdir to return entries only for the root directory
      mockedFs.promises.readdir
        .mockResolvedValueOnce(mockEntries)  // Root directory call
        .mockResolvedValue([]);  // Empty for any subdirectory calls
      
      // Mock stat to return directory stats for mydir
      (mockedFs.promises.stat as any).mockImplementation(async (path: string) => {
        if (path.endsWith('mydir')) {
          return createMockStats(true);  // Directory
        }
        return createMockStats(false);  // File
      });
      
      const result = await provider.getCompletions('my');
      
      const dir = result.items.find(item => item.type === 'directory');
      expect(dir?.value).toMatch(/\/$/);  
    });

    it('should prioritize directories over files', async () => {
      const mockEntries = [
        createMockDirent('afile.txt', false),
        createMockDirent('adir', true)
      ];
      
      // Mock readdir to return entries only for the root directory
      mockedFs.promises.readdir
        .mockResolvedValueOnce(mockEntries)  // Root directory call
        .mockResolvedValue([]);  // Empty for any subdirectory calls
      
      // Mock stat to return correct stats based on path
      (mockedFs.promises.stat as any).mockImplementation(async (path: string) => {
        if (path.endsWith('adir')) {
          return createMockStats(true);  // Directory
        }
        return createMockStats(false);  // File
      });
      
      const result = await provider.getCompletions('a');
      
      // Directory should come first
      expect(result.items[0].type).toBe('directory');
      expect(result.items[0].value).toContain('adir');
    });
  });

  describe('Enhanced Fuzzy Search', () => {
    it('should perform recursive directory traversal', async () => {
      // Mock a multi-level directory structure
      mockedFs.promises.readdir
        .mockResolvedValueOnce([
          createMockDirent('src', true),
          createMockDirent('package.json', false)
        ])
        .mockResolvedValueOnce([
          createMockDirent('components', true)
        ])
        .mockResolvedValueOnce([
          createMockDirent('Button.tsx', false)
        ]);

      const result = await provider.getCompletions('button');
      
      // Should find Button.tsx from nested directory
      const buttonFile = result.items.find(item => 
        item.value.toLowerCase().includes('button')
      );
      expect(buttonFile).toBeDefined();
    });

    it('should handle gitignore-like filtering', async () => {
      const mockEntries = [
        createMockDirent('src', true),
        createMockDirent('node_modules', true),
        createMockDirent('.git', true)
      ];
      
      mockedFs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('src');
      
      // Should include src but exclude gitignored directories in fuzzy search
      const srcResults = result.items.filter(item => item.value.includes('src'));
      expect(srcResults.length).toBeGreaterThan(0);
    });
  });

  describe('Path-based Completion', () => {
    it('should handle explicit path completion', async () => {
      const mockEntries = [
        createMockDirent('config.js', false),
        createMockDirent('utils.js', false)
      ];
      
      // Mock existsSync to return true for the src directory
      mockedFs.existsSync.mockImplementation((path: any) => {
        return path.toString() === '/test/project/src';
      });
      
      // Mock readdir to return different results for different directories
      mockedFs.promises.readdir.mockImplementation(async (dirPath: any) => {
        if (dirPath === '/test/project/src') {
          return mockEntries;  // Return our mock entries for src directory
        }
        return [];  // Return empty for other directories (like fuzzy completion)
      });
      
      const result = await provider.getCompletions('src/');
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe('src/');
    });

    it('should allow explicit traversal into normally ignored directories', async () => {
      const mockEntries = [
        createMockDirent('react', true),
        createMockDirent('typescript', true)
      ];
      
      // Mock existsSync to return true for the node_modules directory
      mockedFs.existsSync.mockImplementation((path: any) => {
        return path.toString() === '/test/project/node_modules';
      });
      
      // Mock readdir to return different results for different directories
      mockedFs.promises.readdir.mockImplementation(async (dirPath: any) => {
        if (dirPath === '/test/project/node_modules') {
          return mockEntries;  // Return our mock entries for node_modules directory
        }
        return [];  // Return empty for other directories (like fuzzy completion)
      });
      
      const result = await provider.getCompletions('node_modules/');
      
      // When explicitly typed, should traverse into node_modules
      expect(result.items.length).toBeGreaterThan(0);
      const explicitResults = result.items.filter(item => 
        item.value.startsWith('node_modules/')
      );
      expect(explicitResults.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle filesystem errors gracefully', async () => {
      mockedFs.promises.readdir.mockRejectedValue(new Error('Permission denied'));
      
      const result = await provider.getCompletions('test');
      
      expect(result.items).toEqual([]);
      expect(result.prefix).toBe('test');
      expect(result.hasMore).toBe(false);
    });

    it('should handle non-existent directories', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      
      const result = await provider.getCompletions('nonexistent/path');
      
      expect(result.items).toEqual([]);
    });

    it('should respect maxItems limit', async () => {
      const mockEntries = Array.from({ length: 30 }, (_, i) => 
        createMockDirent(`file${i}.txt`, false)
      );
      
      mockedFs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('file');
      
      expect(result.items.length).toBeLessThanOrEqual(20); // maxItems = 20
      expect(result.hasMore).toBe(true);
    });
  });

  describe('Configuration Management', () => {
    it('should update current working directory', () => {
      const newCwd = '/new/path';
      provider.setCwd(newCwd);
      
      expect(provider.getCwd()).toBe(path.resolve(newCwd));
    });

    it('should resolve relative paths to absolute', () => {
      provider.setCwd('relative/path');
      
      expect(path.isAbsolute(provider.getCwd())).toBe(true);
    });

    it('should manage hidden file visibility', () => {
      const settings = provider.getSettings();
      expect(settings.showHidden).toBe(false);
      
      provider.setShowHidden(true);
      expect(provider.getSettings().showHidden).toBe(true);
    });
  });
});