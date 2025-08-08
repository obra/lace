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
});
