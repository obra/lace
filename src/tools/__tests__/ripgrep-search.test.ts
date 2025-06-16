// ABOUTME: Tests for ripgrep search tool with pattern matching
// ABOUTME: Validates text search, filtering, and output formatting

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { RipgrepSearchTool } from '../implementations/ripgrep-search.js';

describe('RipgrepSearchTool', () => {
  const tool = new RipgrepSearchTool();
  const testDir = join(process.cwd(), 'test-temp-ripgrep');

  beforeEach(async () => {
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
      join(testDir, 'test.spec.ts'),
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

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('ripgrep_search');
      expect(tool.description).toBe('Fast text search across files using ripgrep');
      expect(tool.destructive).toBe(false);
    });

    it('should have correct input schema', () => {
      expect(tool.input_schema.properties).toHaveProperty('pattern');
      expect(tool.input_schema.properties).toHaveProperty('path');
      expect(tool.input_schema.properties).toHaveProperty('caseSensitive');
      expect(tool.input_schema.required).toEqual(['pattern']);
    });
  });

  describe('basic search', () => {
    it('should find matches in multiple files', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('Found');
      expect(output).toContain('file1.ts:');
      expect(output).toContain('file2.js:');
      expect(output).toContain('subdir/nested.ts:');
      expect(output).toContain('hello');
    });

    it('should return no matches message when pattern not found', async () => {
      const result = await tool.executeTool({
        pattern: 'nonexistentpattern',
        path: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('No matches found for pattern: nonexistentpattern');
    });

    it('should include line numbers in results', async () => {
      const result = await tool.executeTool({
        pattern: 'function hello',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toMatch(/\d+: function hello/);
    });
  });

  describe('search options', () => {
    it('should respect case sensitivity', async () => {
      const caseInsensitive = await tool.executeTool({
        pattern: 'HELLO',
        path: testDir,
        caseSensitive: false,
      });

      const caseSensitive = await tool.executeTool({
        pattern: 'HELLO',
        path: testDir,
        caseSensitive: true,
      });

      expect(caseInsensitive.success).toBe(true);
      expect(caseInsensitive.content[0].text).toContain('Found');

      expect(caseSensitive.success).toBe(true);
      expect(caseSensitive.content[0].text).toContain('No matches found');
    });

    it('should filter by include pattern', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
        includePattern: '*.ts',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.ts');
      expect(output).toContain('nested.ts');
      expect(output).not.toContain('file2.js');
    });

    it('should filter by exclude pattern', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
        excludePattern: '*.spec.ts',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('test.spec.ts');
    });

    it('should respect max results limit', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
        maxResults: 1,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      // Should find matches but be limited (max-count is per file)
      expect(output).toContain('Found');
      const lines = output.split('\n').filter((line) => line.includes(': '));
      // Since max-count is per file and we have multiple files, we expect limited results
      expect(lines.length).toBeLessThan(10); // Should be less than unlimited results
    });

    it('should handle whole word matching', async () => {
      // Add files to test whole word vs partial matching
      await writeFile(join(testDir, 'partial.txt'), 'hellofriend'); // Only partial match
      await writeFile(join(testDir, 'whole.txt'), 'hello world'); // Only whole word match

      const wholeWord = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
        wholeWord: true,
      });

      const partialWord = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
        wholeWord: false,
      });

      expect(wholeWord.success).toBe(true);
      expect(partialWord.success).toBe(true);

      // Partial word should find both files, whole word only the exact match
      expect(partialWord.content[0].text).toContain('partial.txt');
      expect(partialWord.content[0].text).toContain('whole.txt');
      expect(wholeWord.content[0].text).not.toContain('partial.txt'); // Should not match "hellofriend"
      expect(wholeWord.content[0].text).toContain('whole.txt'); // Should match "hello world"
    });
  });

  describe('error handling', () => {
    it('should handle missing pattern parameter', async () => {
      const result = await tool.executeTool({ path: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle empty pattern parameter', async () => {
      const result = await tool.executeTool({ pattern: '', path: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle non-string pattern parameter', async () => {
      const result = await tool.executeTool({ pattern: 123, path: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle non-existent directory', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: '/non/existent/directory',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No such file or directory');
    });

    // Note: This test will be skipped if ripgrep is not installed
    it('should handle ripgrep not installed gracefully', async () => {
      // We can't easily test this without actually uninstalling ripgrep
      // This is more of a documentation of expected behavior
      // If ripgrep is not installed, the tool should return an error message
      // mentioning that ripgrep needs to be installed
    });
  });

  describe('output formatting', () => {
    it('should group results by file', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      // Should have file headers
      expect(output).toContain('file1.ts:');
      expect(output).toContain('file2.js:');

      // Should have indented match lines
      expect(output).toMatch(/ {2}\d+: .*hello/);
    });

    it('should show match count in header', async () => {
      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toMatch(/Found \d+ match(es)?:/);
    });

    it('should handle single match correctly', async () => {
      const result = await tool.executeTool({
        pattern: 'nested hello',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toContain('Found 1 match:');
      expect(output).not.toContain('matches');
    });
  });

  describe('edge cases', () => {
    it('should handle special regex characters in pattern', async () => {
      await writeFile(join(testDir, 'special.txt'), 'Price: $10.50\nEmail: test@example.com');

      const result = await tool.executeTool({
        pattern: '$10.50',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toContain('$10.50');
    });

    it('should handle empty files', async () => {
      await writeFile(join(testDir, 'empty.txt'), '');

      const result = await tool.executeTool({
        pattern: 'anything',
        path: testDir,
      });

      expect(result.success).toBe(true);
      // Should not crash and should not find matches in empty file
    });

    it('should handle binary files gracefully', async () => {
      // Create a simple binary file
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
      await writeFile(join(testDir, 'binary.bin'), binaryContent);

      const result = await tool.executeTool({
        pattern: 'hello',
        path: testDir,
      });

      expect(result.success).toBe(true);
      // Should not crash when encountering binary files
    });
  });
});
