// ABOUTME: Test to verify file_edit tool actually modifies file content
// ABOUTME: Ensures the tool doesn't just return success but actually performs edits

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileEditTool } from '~/tools/implementations/file-edit';

describe('FileEditTool actual file modification', () => {
  let tool: FileEditTool;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    tool = new FileEditTool();
    testDir = join(tmpdir(), 'file-edit-actual-test-' + Date.now());
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, 'test.txt');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should actually modify the file content on disk', async () => {
    const originalContent = 'Hello World';
    await writeFile(testFile, originalContent, 'utf-8');

    // Verify original content
    const beforeEdit = await readFile(testFile, 'utf-8');
    expect(beforeEdit).toBe('Hello World');

    // Perform the edit
    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'World',
            new_text: 'Universe',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    // Check the tool reports success
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('Successfully applied 1 edit');

    // CRITICAL: Verify the file was actually modified
    const afterEdit = await readFile(testFile, 'utf-8');
    expect(afterEdit).toBe('Hello Universe');
    expect(afterEdit).not.toBe(originalContent);
  });

  it('should replace multiple occurrences when using exact text', async () => {
    const originalContent = `line 1
line 2
line 3
line 2
line 5`;

    await writeFile(testFile, originalContent, 'utf-8');

    // Try to replace text that appears twice - should fail
    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'line 2',
            new_text: 'modified line',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    // Should error because text appears multiple times
    expect(result.status).not.toBe('completed');
    expect(result.content[0].text).toContain('Expected 1 occurrence but found 2');

    // File should NOT be modified
    const content = await readFile(testFile, 'utf-8');
    expect(content).toBe(originalContent);
  });

  it('should handle complex multi-line replacements', async () => {
    const originalContent = `function hello() {
  console.log('Hello');
  console.log('World');
  return true;
}`;

    await writeFile(testFile, originalContent, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: `  console.log('Hello');
  console.log('World');`,
            new_text: `  console.log('Hello World');`,
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');

    // Verify the actual file content changed
    const afterEdit = await readFile(testFile, 'utf-8');
    const expectedContent = `function hello() {
  console.log('Hello World');
  return true;
}`;
    expect(afterEdit).toBe(expectedContent);
  });

  it('should preserve file encoding and line endings', async () => {
    const originalContent = 'First line\r\nSecond line\r\nThird line';
    await writeFile(testFile, originalContent, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'Second line',
            new_text: 'Modified line',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');

    const afterEdit = await readFile(testFile, 'utf-8');
    expect(afterEdit).toBe('First line\r\nModified line\r\nThird line');
  });

  it('should fail without modifying file when text not found', async () => {
    const originalContent = 'Hello World';
    await writeFile(testFile, originalContent, 'utf-8');

    const result = await tool.execute(
      {
        path: testFile,
        edits: [
          {
            old_text: 'Goodbye',
            new_text: 'Hello',
          },
        ],
      },
      { signal: new AbortController().signal }
    );

    expect(result.status).not.toBe('completed');
    expect(result.content[0].text).toContain('Could not find exact text');

    // File should remain unchanged
    const afterEdit = await readFile(testFile, 'utf-8');
    expect(afterEdit).toBe(originalContent);
  });
});
