// ABOUTME: Tests for the enhanced file_edit tool with context extraction
// ABOUTME: Verifies that diff context is properly extracted and included in metadata

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool } from '~/tools/implementations/file-edit';
import type { FileEditDiffContext } from '~/tools/implementations/file-edit';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileEditTool context extraction', () => {
  let tool: FileEditTool;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    tool = new FileEditTool();
    testDir = await fs.mkdtemp(join(tmpdir(), 'file-edit-test-'));
    testFile = join(testDir, 'test.txt');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should include diff context in metadata for successful edits', async () => {
    const content = `line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8
line 9
line 10`;

    await fs.writeFile(testFile, content, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'line 5\nline 6',
            new_text: 'modified line 5\nmodified line 6',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.diff).toBeDefined();

    const diff = result.metadata?.diff as FileEditDiffContext;
    expect(diff.beforeContext).toContain('line 2');
    expect(diff.beforeContext).toContain('line 3');
    expect(diff.beforeContext).toContain('line 4');
    expect(diff.afterContext).toContain('line 7');
    expect(diff.afterContext).toContain('line 8');
    expect(diff.afterContext).toContain('line 9');
    expect(diff.oldContent).toContain('line 5\nline 6');
    expect(diff.newContent).toContain('modified line 5\nmodified line 6');
    expect(diff.startLine).toBe(2); // line 2 is where context starts (3 lines before line 5)
  });

  it('should handle edits at the beginning of file', async () => {
    const content = `first line
second line
third line
fourth line
fifth line`;

    await fs.writeFile(testFile, content, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'first line',
            new_text: 'modified first line',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.isError).toBe(false);
    expect(result.metadata?.diff).toBeDefined();

    const diff = result.metadata?.diff as FileEditDiffContext;
    expect(diff.beforeContext).toBe(''); // No context before first line
    expect(diff.afterContext).toContain('second line');
    expect(diff.afterContext).toContain('third line');
    expect(diff.startLine).toBe(1);
  });

  it('should handle edits at the end of file', async () => {
    const content = `line 1
line 2
line 3
line 4
last line`;

    await fs.writeFile(testFile, content, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'last line',
            new_text: 'modified last line',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.isError).toBe(false);
    expect(result.metadata?.diff).toBeDefined();

    const diff = result.metadata?.diff as FileEditDiffContext;
    expect(diff.beforeContext).toContain('line 2');
    expect(diff.beforeContext).toContain('line 3');
    expect(diff.beforeContext).toContain('line 4');
    expect(diff.afterContext).toBe(''); // No context after last line
  });

  it('should handle multi-line replacements with context', async () => {
    const content = `function foo() {
  console.log('hello');
  console.log('world');
  return true;
}

function bar() {
  console.log('test');
}`;

    await fs.writeFile(testFile, content, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: `  console.log('hello');
  console.log('world');
  return true;`,
            new_text: `  console.log('hello world');
  return false;`,
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.isError).toBe(false);
    expect(result.metadata?.diff).toBeDefined();

    const diff = result.metadata?.diff as FileEditDiffContext;
    expect(diff.beforeContext).toContain('function foo() {');
    expect(diff.afterContext).toContain('}');
    expect(diff.oldContent).toContain("console.log('hello')");
    expect(diff.newContent).toContain("console.log('hello world')");
  });

  it('should preserve path and text information in metadata', async () => {
    const content = 'original content';
    await fs.writeFile(testFile, content, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'original',
            new_text: 'modified',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.isError).toBe(false);
    expect(result.metadata?.path).toBe(testFile);
    const editsApplied = result.metadata?.edits_applied as
      | Array<{ old_text: string; new_text: string; occurrences_replaced: number }>
      | undefined;
    expect(editsApplied).toHaveLength(1);
    if (editsApplied && editsApplied.length > 0) {
      const firstEdit = editsApplied[0];
      expect(firstEdit.old_text).toBe('original');
      expect(firstEdit.new_text).toBe('modified');
    }
  });

  describe('Multi-Edit API', () => {
    it('should apply multiple edits sequentially', async () => {
      await fs.writeFile(testFile, 'const a = 1;\nconst b = 2;', 'utf-8');

      const result = await tool.execute(
        {
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
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('let x = 1;\nlet b = 2;');
    });

    it('should show full file diff context for multiple edits', async () => {
      const originalContent = `{
  "name": "test-package",
  "version": "1.0.0",
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          edits: [
            {
              old_text: '"version": "1.0.0"',
              new_text: '"version": "1.1.0"',
            },
            {
              old_text: '"test": "jest"',
              new_text: '"test": "jest",\n    "test:watch": "jest --watch"',
            },
            {
              old_text: '"jest": "^29.0.0"',
              new_text: '"jest": "^29.0.0",\n    "nodemon": "^3.0.0"',
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      expect(result.metadata?.diff).toBeDefined();

      const diff = result.metadata?.diff as FileEditDiffContext;
      // For multi-edit, should show entire original and new file content
      expect(diff.oldContent).toBe(originalContent);
      expect(diff.newContent).toContain('"version": "1.1.0"');
      expect(diff.newContent).toContain('"test:watch": "jest --watch"');
      expect(diff.newContent).toContain('"nodemon": "^3.0.0"');
      expect(diff.startLine).toBe(1);
      expect(diff.beforeContext).toBe(''); // Full file diff doesn't use context
      expect(diff.afterContext).toBe('');
    });

    it('should fail when occurrence count does not match', async () => {
      await fs.writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          edits: [
            {
              old_text: 'foo',
              new_text: 'qux',
              occurrences: 2, // Actually has 3
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Expected 2 occurrences but found 3');

      // File should not be modified
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('foo bar foo baz foo');
    });
  });

  describe('Dry Run Mode', () => {
    it('should not modify file in dry run mode', async () => {
      const originalContent = 'Hello World';
      await fs.writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          dry_run: true,
          edits: [
            {
              old_text: 'World',
              new_text: 'Universe',
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Dry run');
      expect(result.metadata?.dry_run).toBe(true);

      // File should not be modified
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe(originalContent);
    });

    it('should include diff context in dry run mode', async () => {
      const originalContent = 'Hello World';
      await fs.writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          dry_run: true,
          edits: [
            {
              old_text: 'World',
              new_text: 'Universe',
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Dry run');
      expect(result.metadata?.dry_run).toBe(true);
      expect(result.metadata?.diff).toBeDefined();

      // File should not be modified
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe(originalContent);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file', async () => {
      await fs.writeFile(testFile, '', 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          edits: [
            {
              old_text: 'foo',
              new_text: 'bar',
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Could not find exact text');
    });

    it('should handle file not found', async () => {
      const result = await tool.execute(
        {
          path: '/nonexistent/file.txt',
          edits: [
            {
              old_text: 'foo',
              new_text: 'bar',
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should preserve line endings', async () => {
      await fs.writeFile(testFile, 'line1\r\nline2\r\nline3', 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          edits: [
            {
              old_text: 'line2',
              new_text: 'modified',
            },
          ],
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      const content = await fs.readFile(testFile, 'utf-8');
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
      await fs.writeFile(testFile, content, 'utf-8');

      // Create 10 different edits, each targeting a unique pattern
      const edits = Array(10)
        .fill(null)
        .map((_, i) => ({
          old_text: `${String.fromCharCode(97 + i)}unique${String.fromCharCode(97 + i)}`,
          new_text: `${String.fromCharCode(97 + i)}replaced${String.fromCharCode(97 + i)}`,
          occurrences: 1,
        }));

      const start = Date.now();
      const result = await tool.execute(
        {
          path: testFile,
          edits,
        },
        { signal: new AbortController().signal }
      );
      const duration = Date.now() - start;

      expect(result.isError).toBe(false);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
