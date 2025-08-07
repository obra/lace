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

    const result = await tool.execute({
      path: testFile,
      old_text: 'line 5\nline 6',
      new_text: 'modified line 5\nmodified line 6',
    });

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

    const result = await tool.execute({
      path: testFile,
      old_text: 'first line',
      new_text: 'modified first line',
    });

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

    const result = await tool.execute({
      path: testFile,
      old_text: 'last line',
      new_text: 'modified last line',
    });

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

    const result = await tool.execute({
      path: testFile,
      old_text: `  console.log('hello');
  console.log('world');
  return true;`,
      new_text: `  console.log('hello world');
  return false;`,
    });

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

    const result = await tool.execute({
      path: testFile,
      old_text: 'original',
      new_text: 'modified',
    });

    expect(result.isError).toBe(false);
    expect(result.metadata?.path).toBe(testFile);
    expect(result.metadata?.oldText).toBe('original');
    expect(result.metadata?.newText).toBe('modified');
  });
});
