// ABOUTME: Tests for the file edit tool
// ABOUTME: Validates exact text replacement and error handling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool } from '../implementations/file-edit.js';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileEditTool', () => {
  const tool = new FileEditTool();
  const testDir = join(tmpdir(), 'file-edit-test');
  const testFile = join(testDir, 'test.txt');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await unlink(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
    await rmdir(testDir);
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('file_edit');
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.input_schema.required).toEqual(['path', 'old_text', 'new_text']);
  });

  it('should replace exact text match', async () => {
    const originalContent = `function hello() {
  console.log('Hello, World!');
}`;
    await writeFile(testFile, originalContent);

    const result = await tool.executeTool({
      path: testFile,
      old_text: "console.log('Hello, World!');",
      new_text: "console.log('Hello, Universe!');",
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Successfully replaced text');
  });

  it('should handle multi-line replacements', async () => {
    const originalContent = `function calculate() {
  const a = 1;
  const b = 2;
  return a + b;
}`;
    await writeFile(testFile, originalContent);

    const result = await tool.executeTool({
      path: testFile,
      old_text: `  const a = 1;
  const b = 2;
  return a + b;`,
      new_text: `  const x = 10;
  const y = 20;
  return x * y;`,
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Successfully replaced text');
    expect(result.content[0]?.text).toContain('3 lines');
  });

  it('should fail when text is not found', async () => {
    await writeFile(testFile, 'Hello World');

    const result = await tool.executeTool({
      path: testFile,
      old_text: 'Goodbye World',
      new_text: 'Hello Universe',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No exact matches found');
  });

  it('should fail when multiple matches exist', async () => {
    await writeFile(testFile, 'foo bar foo');

    const result = await tool.executeTool({
      path: testFile,
      old_text: 'foo',
      new_text: 'baz',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Found 2 matches');
  });

  it('should validate input parameters', async () => {
    const result = await tool.executeTool({
      path: '',
      old_text: 'test',
      new_text: 'test2',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Path must be a non-empty string');
  });

  it('should handle file not found', async () => {
    const result = await tool.executeTool({
      path: '/nonexistent/file.txt',
      old_text: 'test',
      new_text: 'test2',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ENOENT');
  });
});
