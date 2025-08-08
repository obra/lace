// ABOUTME: Comprehensive tests for enhanced file_edit tool with multiple edits support
// ABOUTME: Tests occurrence validation, sequential processing, and LLM-friendly errors

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileEditTool } from '~/tools/implementations/file-edit-multi';

describe('FileEditTool Multi', () => {
  let tool: FileEditTool;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    tool = new FileEditTool();
    const tempDir = await mkdir(join(tmpdir(), 'file-edit-multi-test-' + Date.now()), {
      recursive: true,
    });
    testDir = tempDir!;
    testFile = join(testDir, 'test.txt');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Single Edit Operations', () => {
    it('should replace single occurrence by default', async () => {
      // Write test first, then implement
      await writeFile(testFile, 'Hello World', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'World',
            new_text: 'Universe',
          },
        ],
      });

      expect(result.isError).toBe(false);
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('Hello Universe');
    });

    it('should fail when occurrence count does not match', async () => {
      await writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'foo',
            new_text: 'qux',
            occurrences: 2, // Actually has 3
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Expected 2 occurrences but found 3');

      // File should not be modified
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('foo bar foo baz foo');
    });
  });

  describe('Multiple Edit Operations', () => {
    it('should apply multiple edits sequentially', async () => {
      await writeFile(testFile, 'const a = 1;\nconst b = 2;', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'const',
            new_text: 'let',
            occurrences: 2,
          },
          {
            old_text: 'let a',
            new_text: 'let x',
          },
        ],
      });

      expect(result.isError).toBe(false);
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('let x = 1;\nlet b = 2;');
    });
  });

  describe('Dry Run Mode', () => {
    it('should not modify file in dry run mode', async () => {
      const originalContent = 'Hello World';
      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        dry_run: true,
        edits: [
          {
            old_text: 'World',
            new_text: 'Universe',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Dry run');
      expect(result.metadata?.dry_run).toBe(true);

      // File should not be modified
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe(originalContent);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file', async () => {
      await writeFile(testFile, '', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'foo',
            new_text: 'bar',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No matches found');
    });

    it('should handle file not found', async () => {
      const result = await tool.execute({
        path: '/nonexistent/file.txt',
        edits: [
          {
            old_text: 'foo',
            new_text: 'bar',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should preserve line endings', async () => {
      await writeFile(testFile, 'line1\r\nline2\r\nline3', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'line2',
            new_text: 'modified',
          },
        ],
      });

      expect(result.isError).toBe(false);
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('line1\r\nmodified\r\nline3');
    });
  });

  describe('Performance', () => {
    it('should handle many edits efficiently', async () => {
      // Create file with unique patterns for each edit (using letters to avoid substring overlap)
      const content = Array(10)
        .fill(null)
        .map(
          (_, i) => `line with ${String.fromCharCode(97 + i)}unique${String.fromCharCode(97 + i)}`
        )
        .join('\n');
      await writeFile(testFile, content, 'utf-8');

      // Create 10 different edits, each targeting a unique pattern
      const edits = Array(10)
        .fill(null)
        .map((_, i) => ({
          old_text: `${String.fromCharCode(97 + i)}unique${String.fromCharCode(97 + i)}`,
          new_text: `${String.fromCharCode(97 + i)}replaced${String.fromCharCode(97 + i)}`,
          occurrences: 1,
        }));

      const start = Date.now();
      const result = await tool.execute({
        path: testFile,
        edits,
      });
      const duration = Date.now() - start;

      expect(result.isError).toBe(false);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
