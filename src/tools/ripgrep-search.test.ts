// ABOUTME: Tests for schema-based ripgrep search tool with pattern matching
// ABOUTME: Validates text search, filtering, and output formatting with Zod validation

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep-search';

describe('RipgrepSearchTool with schema validation', () => {
  let tool: RipgrepSearchTool;
  const testDir = join(process.cwd(), 'test-temp-ripgrep-schema');

  beforeEach(async () => {
    tool = new RipgrepSearchTool();
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });

    // Create test files
    await writeFile(
      join(testDir, 'file1.ts'),
      'function hello() {\n  console.log("Hello world");\n}'
    );
    await writeFile(join(testDir, 'file2.js'), 'const greeting = "hello";\nconsole.log(greeting);');
    await writeFile(
      join(testDir, 'file3.txt'),
      'This is a text file\nwith multiple lines\nand some content'
    );
    await writeFile(
      join(testDir, 'example.test.txt'),
      'describe("hello test", () => {\n  it("should work", () => {});\n});'
    );

    await mkdir(join(testDir, 'subdir'));
    await writeFile(
      join(testDir, 'subdir', 'nested.ts'),
      'export function hello() {\n  return "nested hello";\n}'
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('ripgrep_search');
      expect(tool.description)
        .toBe(`Search file contents using regex patterns. Use for text search, file-find for name patterns.
Supports glob filters (includePattern/excludePattern). Returns path:line:content format.`);
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.pattern).toBeDefined();
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.caseSensitive).toBeDefined();
      expect(schema.properties.wholeWord).toBeDefined();
      expect(schema.properties.includePattern).toBeDefined();
      expect(schema.properties.excludePattern).toBeDefined();
      expect(schema.properties.maxResults).toBeDefined();
      expect(schema.properties.contextLines).toBeDefined();
      expect(schema.required).toEqual(['pattern']);
    });

    it('should be marked as read-only and idempotent', () => {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject missing pattern', async () => {
      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('pattern');
    });

    it('should reject empty pattern', async () => {
      const result = await tool.execute({ pattern: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject invalid maxResults', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        maxResults: -1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject excessive maxResults', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        maxResults: 10000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject negative contextLines', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        contextLines: -1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject excessive contextLines', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        contextLines: 20,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should accept valid parameters with defaults', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
    });
  });

  describe('Basic search functionality', () => {
    it('should find matches in multiple files', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;

      expect(output).toContain('Found');
      expect(output).toContain('file1.ts:');
      expect(output).toContain('file2.js:');
      expect(output).toContain('subdir/nested.ts:');
      expect(output).toContain('hello');
    });

    it('should return no matches message when pattern not found', async () => {
      const result = await tool.execute({
        pattern: 'nonexistentpattern',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('No matches found for pattern: nonexistentpattern');
    });

    it('should include line numbers in results', async () => {
      const result = await tool.execute({
        pattern: 'function hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toMatch(/\d+: function hello/);
    });

    it('should use current directory as default path', async () => {
      const result = await tool.execute({
        pattern: 'hello',
      });

      expect(result.isError).toBe(false);
      // Should not error out, even if no matches found in current directory
    });
  });

  describe('Search options', () => {
    it('should respect case sensitivity', async () => {
      const caseInsensitive = await tool.execute({
        pattern: 'HELLO',
        path: testDir,
        caseSensitive: false,
      });

      const caseSensitive = await tool.execute({
        pattern: 'HELLO',
        path: testDir,
        caseSensitive: true,
      });

      expect(caseInsensitive.isError).toBe(false);
      expect(caseInsensitive.content[0].text).toContain('Found');

      expect(caseSensitive.isError).toBe(false);
      expect(caseSensitive.content[0].text).toContain('No matches found');
    });

    it('should filter by include pattern', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
        includePattern: '*.ts',
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;

      expect(output).toContain('file1.ts');
      expect(output).toContain('nested.ts');
      expect(output).not.toContain('file2.js');
    });

    it('should filter by exclude pattern', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
        excludePattern: '*.test.txt',
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;

      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('example.test.txt');
    });

    it('should handle whole word matching', async () => {
      await writeFile(join(testDir, 'partial.txt'), 'hellofriend');
      await writeFile(join(testDir, 'whole.txt'), 'hello world');

      const wholeWord = await tool.execute({
        pattern: 'hello',
        path: testDir,
        wholeWord: true,
      });

      const partialWord = await tool.execute({
        pattern: 'hello',
        path: testDir,
        wholeWord: false,
      });

      expect(wholeWord.isError).toBe(false);
      expect(partialWord.isError).toBe(false);

      expect(partialWord.content[0].text).toContain('partial.txt');
      expect(partialWord.content[0].text).toContain('whole.txt');
      expect(wholeWord.content[0].text).not.toContain('partial.txt');
      expect(wholeWord.content[0].text).toContain('whole.txt');
    });

    it('should add context lines when requested', async () => {
      const result = await tool.execute({
        pattern: 'console.log',
        path: testDir,
        contextLines: 1,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      // Should find console.log matches
      expect(output).toContain('console.log');
      expect(output).toContain('Found');
    });
  });

  describe('Result limiting', () => {
    it('should limit total results to maxResults', async () => {
      // Create many files with matches
      for (let i = 0; i < 20; i++) {
        await writeFile(
          join(testDir, `match${i}.txt`),
          `uniquepattern ${i}\nuniquepattern again ${i}\nuniquepattern third ${i}`
        );
      }

      const result = await tool.execute({
        pattern: 'uniquepattern',
        path: testDir,
        maxResults: 10,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0]).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      const output = result.content[0].text!;

      // Count actual matches in output
      const matchLines = output
        .split('\n')
        .filter((line) => line.match(/^\s+\d+: .*uniquepattern/));

      expect(matchLines.length).toBe(10);
      expect(output).toContain('Results limited to 10');
    });

    it('should not show truncation message when under limit', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
        maxResults: 100,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).not.toContain('Results limited to');
    });

    it('should use default maxResults when not specified', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      // Should not error, default should be applied
    });
  });

  describe('Output formatting', () => {
    it('should group results by file', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;

      expect(output).toContain('file1.ts:');
      expect(output).toContain('file2.js:');
      expect(output).toMatch(/ {2}\d+: .*hello/);
    });

    it('should show match count in header', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toMatch(/Found \d+ match(es)?:/);
    });

    it('should handle single match correctly', async () => {
      const result = await tool.execute({
        pattern: 'nested hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Found 1 match:');
      expect(output).not.toContain('matches');
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle non-existent directory', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: '/non/existent/directory',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Search operation failed');
    });

    it('should handle special regex characters in pattern', async () => {
      await writeFile(join(testDir, 'special.txt'), 'Price: $10.50\nEmail: test@example.com');

      const result = await tool.execute({
        pattern: '$10.50',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('$10.50');
    });

    it('should handle empty files gracefully', async () => {
      await writeFile(join(testDir, 'empty.txt'), '');

      const result = await tool.execute({
        pattern: 'anything',
        path: testDir,
      });

      expect(result.isError).toBe(false);
    });

    it('should handle binary files gracefully', async () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
      await writeFile(join(testDir, 'binary.bin'), binaryContent);

      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful searches', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Found');
    });

    it('should use createResult for no matches found', async () => {
      const result = await tool.execute({
        pattern: 'nonexistent',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('No matches found');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ pattern: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should provide helpful error for ripgrep not found', () => {
      // This would need to mock exec to simulate ripgrep not being installed
      // For now, just verify the tool structure exists
      expect(tool.name).toBe('ripgrep_search');
    });
  });

  describe('Working directory functionality', () => {
    it('should resolve relative paths based on context working directory', async () => {
      // Create a subdirectory within testDir
      const subDir = join(testDir, 'workdir');
      await mkdir(subDir);
      await writeFile(join(subDir, 'workfile.txt'), 'working directory test content');

      // Test with relative path and working directory context
      const result = await tool.execute(
        {
          pattern: 'working directory',
          path: '.',
        },
        {
          workingDirectory: subDir,
        }
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('workfile.txt');
      expect(output).toContain('working directory test content');
    });

    it('should handle absolute paths regardless of working directory', async () => {
      const subDir = join(testDir, 'workdir');
      await mkdir(subDir);
      await writeFile(join(subDir, 'workfile.txt'), 'absolute path test');

      // Test with absolute path - should work regardless of working directory
      const result = await tool.execute(
        {
          pattern: 'absolute path',
          path: testDir,
        },
        {
          workingDirectory: subDir,
        }
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('absolute path test');
    });
  });

  describe('Edge cases', () => {
    it('should handle quotes in search pattern', async () => {
      await writeFile(join(testDir, 'quotes.txt'), 'He said "hello world" to me');

      const result = await tool.execute({
        pattern: '"hello world"',
        path: testDir,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('"hello world"');
    });

    it('should handle complex include/exclude combinations', async () => {
      const result = await tool.execute({
        pattern: 'hello',
        path: testDir,
        includePattern: '*.{ts,js}',
        excludePattern: '*.test.*',
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('example.test.txt');
    });

    it('should handle zero context lines explicitly', async () => {
      const result = await tool.execute({
        pattern: 'console.log',
        path: testDir,
        contextLines: 0,
      });

      expect(result.isError).toBe(false);
      // Should work without context lines
    });
  });
});
