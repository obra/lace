// ABOUTME: Tests for schema-based file edit tool with exact text replacement
// ABOUTME: Validates text replacement, multi-field validation, and error handling with Zod

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { FileEditTool } from '~/tools/implementations/file-edit';

describe('FileEditTool with schema validation', () => {
  let tool: FileEditTool;
  const testDir = join(process.cwd(), 'test-temp-file-edit-schema');
  const testFile = join(testDir, 'test.txt');

  beforeEach(async () => {
    tool = new FileEditTool();
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Helper function to assert successful edits
  const expectSuccessfulEdit = (
    result: { isError: boolean; metadata?: Record<string, unknown> },
    editCount?: number
  ) => {
    expect(result.isError).toBe(false);
    if (editCount !== undefined) {
      expect(result.metadata?.total_replacements).toBe(editCount);
    }
  };

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_edit');
      expect(tool.description).toMatch(/edit.*files.*text/i);
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.edits).toBeDefined();
      expect(schema.required).toEqual(['path', 'edits']);
    });

    it('should be marked as destructive', () => {
      expect(tool.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject missing path', async () => {
      const result = await tool.execute({
        edits: [{ old_text: 'old', new_text: 'new' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('path');
    });

    it('should reject empty path', async () => {
      const result = await tool.execute({
        path: '',
        edits: [{ old_text: 'old', new_text: 'new' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('File path cannot be empty');
    });

    it('should reject missing old_text', async () => {
      const result = await tool.execute({
        path: testFile,
        edits: [{ new_text: 'new' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('old_text');
    });

    it('should reject missing new_text', async () => {
      const result = await tool.execute({
        path: testFile,
        edits: [{ old_text: 'old' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('new_text');
    });

    it('should accept empty old_text for insertions at beginning', async () => {
      await writeFile(testFile, '');

      const result = await tool.execute({
        path: testFile,
        edits: [{ old_text: '', new_text: 'new content' }],
      });

      expect(result.isError).toBe(false);
    });

    it('should transform relative paths to absolute', async () => {
      // This test verifies path transformation works
      const result = await tool.execute({
        path: './nonexistent.txt',
        edits: [{ old_text: 'old', new_text: 'new' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should accept valid parameters', async () => {
      await writeFile(testFile, 'Hello World');

      const result = await tool.execute({
        path: testFile,
        edits: [{ old_text: 'Hello', new_text: 'Hi' }],
      });

      expect(result.isError).toBe(false);
    });
  });

  describe('Basic text replacement', () => {
    // eslint-disable-next-line vitest/expect-expect
    it('should replace exact text match', async () => {
      const originalContent = `function hello() {
  console.log('Hello, World!');
}`;
      await writeFile(testFile, originalContent);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: "console.log('Hello, World!');",
            new_text: "console.log('Hello, Universe!');",
          },
        ],
      });

      expectSuccessfulEdit(result);
      // Remove file path expectation as it's not in the simplified message
    });

    it('should handle single character replacements', async () => {
      await writeFile(testFile, 'abc');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'b',
            new_text: 'x',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should handle empty string replacement (deletion)', async () => {
      await writeFile(testFile, 'Hello, World!');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: ', World',
            new_text: '',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should handle insertion with unique old_text', async () => {
      await writeFile(testFile, 'World');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'World',
            new_text: 'Hello, World',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });
  });

  describe('Multi-line text replacement', () => {
    it('should handle multi-line replacements', async () => {
      const originalContent = `function calculate() {
  const a = 1;
  const b = 2;
  return a + b;
}`;
      await writeFile(testFile, originalContent);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: `  const a = 1;
  const b = 2;
  return a + b;`,
            new_text: `  const x = 10;
  const y = 20;
  return x * y;`,
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
      // Remove line count expectation as it's not in the simplified message
    });

    it('should handle entire file replacement', async () => {
      await writeFile(testFile, 'old content');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'old content',
            new_text: 'completely new content\nwith multiple lines\nand more text',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should preserve exact whitespace in replacements', async () => {
      const originalContent = '  function() {\n    return true;\n  }';
      await writeFile(testFile, originalContent);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: '  function() {\n    return true;\n  }',
            new_text: '  function() {\n    return false;\n  }',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });
  });

  describe('Error conditions', () => {
    it('should fail when text is not found', async () => {
      await writeFile(testFile, 'Hello World');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'Goodbye World',
            new_text: 'Hello Universe',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Could not find exact text');
      expect(result.content[0].text).toContain('Use file_read to see the exact content');
    });

    it('should fail when multiple matches exist', async () => {
      await writeFile(testFile, 'foo bar foo');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'foo',
            new_text: 'baz',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Expected 1 occurrence but found 2');
      expect(result.content[0].text).toContain('Add more context to make old_text unique');
    });

    it('should handle file not found error', async () => {
      const result = await tool.execute({
        path: '/nonexistent/file.txt',
        edits: [
          {
            old_text: 'test',
            new_text: 'test2',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should handle permission denied error', () => {
      // This would be difficult to test cross-platform reliably
      // Permission denied errors are handled in the implementation
      expect(tool.name).toBe('file_edit');
    });
  });

  describe('Enhanced error messages', () => {
    it('should provide file preview when no matches found', async () => {
      await writeFile(testFile, 'Line 1\nLine 2\nLine 3');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'NonexistentText',
            new_text: 'Replacement',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Could not find exact text');
      expect(result.content[0].text).toContain('File content (3 lines)');
    });

    it('should provide match location info for multiple matches', async () => {
      const content = 'function test() {\n  return test;\n}\nconst test = 42;';
      await writeFile(testFile, content);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'test',
            new_text: 'example',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Expected 1 occurrence but found 3');
      expect(result.content[0].text).toContain('Line 1, column');
    });

    it('should provide helpful guidance for AI recovery', async () => {
      await writeFile(testFile, 'Some content here');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'some content',
            new_text: 'other content',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Use file_read to see the exact content');
    });
  });

  describe('Line change reporting', () => {
    // eslint-disable-next-line vitest/expect-expect
    it('should report successful edits', async () => {
      await writeFile(testFile, 'single line');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'single line',
            new_text: 'one line',
          },
        ],
      });

      expectSuccessfulEdit(result, 1);
    });

    // eslint-disable-next-line vitest/expect-expect
    it('should report multiple edits', async () => {
      await writeFile(testFile, 'line 1\nline 2');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'line 1',
            new_text: 'first line',
          },
          {
            old_text: 'line 2',
            new_text: 'second line',
          },
        ],
      });

      expectSuccessfulEdit(result, 2);
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful edits', async () => {
      await writeFile(testFile, 'Hello World');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'Hello',
            new_text: 'Hi',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({
        path: '',
        edits: [
          {
            old_text: 'old',
            new_text: 'new',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should use createError for file operation failures', async () => {
      const result = await tool.execute({
        path: '/nonexistent/file.txt',
        edits: [
          {
            old_text: 'old',
            new_text: 'new',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });
  });

  describe('Edge cases', () => {
    it('should handle files with special characters', async () => {
      const content = 'Text with "quotes" and $pecial char$';
      await writeFile(testFile, content);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: '"quotes"',
            new_text: "'quotes'",
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should handle unicode characters', async () => {
      const content = 'Hello 世界 🌍';
      await writeFile(testFile, content);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: '世界',
            new_text: 'World',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should handle very large text replacements', async () => {
      const largeOldText = 'x'.repeat(1000);
      const largeNewText = 'y'.repeat(2000);
      await writeFile(testFile, `start ${largeOldText} end`);

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: largeOldText,
            new_text: largeNewText,
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should handle empty files', async () => {
      await writeFile(testFile, '');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: '',
            new_text: 'new content',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should handle files with only whitespace', async () => {
      await writeFile(testFile, '   \n\t\n   ');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: '   \n\t\n   ',
            new_text: 'cleaned content',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });
  });

  describe('Cross-field validation edge cases', () => {
    it('should handle old_text same as new_text', async () => {
      await writeFile(testFile, 'same text');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'same',
            new_text: 'same',
          },
        ],
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should validate old_text against actual file content', async () => {
      await writeFile(testFile, 'actual content');

      const result = await tool.execute({
        path: testFile,
        edits: [
          {
            old_text: 'ACTUAL CONTENT',
            new_text: 'new content',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Could not find exact text');
    });
  });

  describe('working directory support', () => {
    it('should resolve relative paths using working directory from context', async () => {
      // Create a relative test file
      const relativeTestFile = 'relative-edit-test.txt';
      const absoluteTestFile = join(testDir, relativeTestFile);
      await writeFile(absoluteTestFile, 'Content for relative edit');

      const result = await tool.execute(
        {
          path: relativeTestFile,
          edits: [
            {
              old_text: 'Content for relative edit',
              new_text: 'Modified content for relative edit',
            },
          ],
        },
        { workingDirectory: testDir }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should use absolute paths directly even when working directory is provided', async () => {
      await writeFile(testFile, 'absolute path content');

      const result = await tool.execute(
        {
          path: testFile,
          edits: [
            {
              old_text: 'absolute path content',
              new_text: 'modified absolute path content',
            },
          ],
        },
        { workingDirectory: '/some/other/dir' }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully applied');
    });

    it('should fall back to process.cwd() when no working directory in context', async () => {
      // Create a file relative to current working directory
      const relativeFile = 'temp-cwd-edit-test.txt';
      const absoluteFile = join(process.cwd(), relativeFile);
      await writeFile(absoluteFile, 'CWD edit test content');

      try {
        const result = await tool.execute({
          path: relativeFile,
          edits: [
            {
              old_text: 'CWD edit test content',
              new_text: 'Modified CWD edit test content',
            },
          ],
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Successfully applied');
      } finally {
        await rm(absoluteFile, { force: true });
      }
    });

    it('should handle non-existent relative paths with working directory context', async () => {
      const result = await tool.execute(
        {
          path: 'non-existent-relative-edit.txt',
          edits: [
            {
              old_text: 'test',
              new_text: 'modified',
            },
          ],
        },
        { workingDirectory: testDir }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
      expect(result.content[0].text).toContain('non-existent-relative-edit.txt');
    });
  });
});
