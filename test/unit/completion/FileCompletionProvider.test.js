// ABOUTME: Unit tests for FileCompletionProvider  
// ABOUTME: Tests file and directory completion with mocked filesystem

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as path from 'path';

// Mock fs module for ESM
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  promises: {
    readdir: jest.fn()
  }
}));

// Import after mocking
const { FileCompletionProvider } = await import('../../../src/ui/completion/FileCompletionProvider.js');
const fs = await import('fs');

describe('FileCompletionProvider', () => {
  let provider;
  let mockCwd;

  beforeEach(() => {
    mockCwd = '/test/dir';
    provider = new FileCompletionProvider({ cwd: mockCwd, maxItems: 10 });
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up default mock returns
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({
      isDirectory: () => false,
      size: 1024
    });
  });

  describe('canHandle', () => {
    it('should handle non-command contexts', () => {
      const context = {
        line: 'some text',
        column: 5,
        lineNumber: 0,
        fullText: 'some text'
      };
      
      expect(provider.canHandle(context)).toBe(true);
    });

    it('should not handle slash commands on first line', () => {
      const context = {
        line: '/help',
        column: 5,
        lineNumber: 0,
        fullText: '/help'
      };
      
      expect(provider.canHandle(context)).toBe(false);
    });

    it('should handle slash commands on non-first lines', () => {
      const context = {
        line: '/some/path',
        column: 5,
        lineNumber: 1,
        fullText: 'first line\n/some/path'
      };
      
      expect(provider.canHandle(context)).toBe(true);
    });
  });

  describe('getCompletions', () => {

    it('should return file completions', async () => {
      const mockEntries = [
        { name: 'file1.txt', isDirectory: () => false },
        { name: 'file2.js', isDirectory: () => false },
        { name: 'subdir', isDirectory: () => true }
      ];
      
      fs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('file');
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe('file');
      
      // Should find matching files
      const file1 = result.items.find(item => item.value.includes('file1.txt'));
      expect(file1).toBeDefined();
      expect(file1.type).toBe('file');
    });

    it('should prioritize directories over files', async () => {
      const mockEntries = [
        { name: 'afile.txt', isDirectory: () => false },
        { name: 'adir', isDirectory: () => true }
      ];
      
      fs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('a');
      
      // Directory should come first
      expect(result.items[0].type).toBe('directory');
      expect(result.items[0].value).toContain('adir');
    });

    it('should add trailing slash to directories', async () => {
      const mockEntries = [
        { name: 'mydir', isDirectory: () => true }
      ];
      
      fs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('my');
      
      const dir = result.items.find(item => item.type === 'directory');
      expect(dir.value).toMatch(/\/$/);  
    });

    it('should handle empty directory gracefully', async () => {
      fs.promises.readdir.mockResolvedValue([]);
      
      const result = await provider.getCompletions('nothing');
      
      expect(result.items).toHaveLength(0);
      expect(result.prefix).toBe('nothing');
    });

    it('should handle filesystem errors gracefully', async () => {
      fs.existsSync.mockReturnValue(false);
      
      const result = await provider.getCompletions('nonexistent');
      
      expect(result.items).toHaveLength(0);
      expect(result.prefix).toBe('nonexistent');
    });

    it('should filter hidden files unless requested', async () => {
      const mockEntries = [
        { name: '.hidden', isDirectory: () => false },
        { name: 'visible.txt', isDirectory: () => false }
      ];
      
      fs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('');
      
      // Should not include hidden file
      const hiddenFile = result.items.find(item => item.value.includes('.hidden'));
      expect(hiddenFile).toBeUndefined();
      
      // Should include visible file
      const visibleFile = result.items.find(item => item.value.includes('visible.txt'));
      expect(visibleFile).toBeDefined();
    });

    it('should include hidden files when prefix starts with dot', async () => {
      const mockEntries = [
        { name: '.hidden', isDirectory: () => false },
        { name: '.gitignore', isDirectory: () => false }
      ];
      
      fs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('.h');
      
      const hiddenFile = result.items.find(item => item.value.includes('.hidden'));
      expect(hiddenFile).toBeDefined();
    });

    it('should respect maxItems limit', async () => {
      const mockEntries = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.txt`,
        isDirectory: () => false
      }));
      
      fs.promises.readdir.mockResolvedValue(mockEntries);
      
      const result = await provider.getCompletions('file');
      
      expect(result.items.length).toBeLessThanOrEqual(10); // maxItems = 10
      expect(result.hasMore).toBe(true);
    });
  });

  describe('directory management', () => {
    it('should update current working directory', () => {
      const newCwd = '/new/path';
      provider.setCwd(newCwd);
      
      expect(provider.getCwd()).toBe(path.resolve(newCwd));
    });

    it('should resolve relative paths to absolute', () => {
      provider.setCwd('relative/path');
      
      expect(path.isAbsolute(provider.getCwd())).toBe(true);
    });
  });
});