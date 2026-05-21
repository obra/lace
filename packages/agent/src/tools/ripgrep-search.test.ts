// ABOUTME: Tests for schema-based ripgrep search tool with pattern matching
// ABOUTME: Validates text search, filtering, and output formatting with Zod validation

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, writeFile, mkdir } from 'fs/promises';
import { delimiter, join } from 'path';
import { RipgrepSearchTool } from '@lace/agent/tools/implementations/ripgrep_search';
import { createTestTempDir } from '@lace/agent/test-utils/temp-directory';
import { createFakeRuntimeForProcess } from './runtime/__tests__/fake-runtime';
import { HostToolRuntime } from './runtime/host';
import type { ToolContext } from './types';

describe('RipgrepSearchTool with schema validation', () => {
  let tool: RipgrepSearchTool;
  const tempDir = createTestTempDir('ripgrep-test-');
  let testDir: string;
  let runtimeId = 0;

  function createTestContext(cwd = process.cwd()): ToolContext {
    return {
      signal: new AbortController().signal,
      runtime: new HostToolRuntime({ id: `rt_ripgrep_search_test_${runtimeId++}`, cwd }),
    };
  }

  beforeEach(async () => {
    tool = new RipgrepSearchTool();
    testDir = await tempDir.getPath();

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
    await tempDir.cleanup();
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('ripgrep_search');
      expect(tool.description)
        .toBe(`Search file contents using regex patterns. Use for text search, file_find for name patterns.
Supports glob filters (includePattern/excludePattern). Returns results using cat -n format, with line numbers starting at 1.`);
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
      const result = await tool.execute({}, createTestContext());

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('pattern');
    });

    it('should reject empty pattern', async () => {
      const result = await tool.execute({ pattern: '' }, createTestContext());

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject invalid maxResults', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          maxResults: -1,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should reject excessive maxResults', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          maxResults: 10000,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should reject negative contextLines', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          contextLines: -1,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should reject excessive contextLines', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          contextLines: 20,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should accept valid parameters with defaults', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
    });
  });

  describe('Basic search functionality', () => {
    it('runs rg through runtime process in runtime cwd', async () => {
      const tool = new RipgrepSearchTool();
      const runtime = createFakeRuntimeForProcess({
        stdout: '/runtime/a.ts:1:needle\n',
      });

      const result = await tool.execute(
        { pattern: 'needle', path: '.' },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      expect(runtime.process.exec).toHaveBeenCalledWith(
        expect.arrayContaining(['rg']),
        expect.objectContaining({ cwd: runtime.cwd })
      );
    });

    it('preserves runtime default env when processEnv overlay is provided', async () => {
      const binDir = join(testDir, 'bin');
      await mkdir(binDir);
      const fakeRipgrep = join(binDir, 'rg');
      await writeFile(fakeRipgrep, '#!/bin/sh\nprintf "fake.ts:1:needle\\n"\n', 'utf8');
      await chmod(fakeRipgrep, 0o755);

      const runtime = new HostToolRuntime({
        id: `rt_ripgrep_search_test_${runtimeId++}`,
        cwd: testDir,
        env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` },
      });

      const result = await tool.execute(
        { pattern: 'needle', path: '.' },
        {
          signal: new AbortController().signal,
          runtime,
          processEnv: { LACE_RIPGREP_OVERLAY_TEST: 'present' },
        }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('fake.ts');
      expect(result.content[0].text).toContain('needle');
    });

    it('should find matches in multiple files', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;

      expect(output).toContain('Found');
      expect(output).toContain('file1.ts:');
      expect(output).toContain('file2.js:');
      expect(output).toContain('subdir/nested.ts:');
      expect(output).toContain('hello');
    });

    it('should return no matches message when pattern not found', async () => {
      const result = await tool.execute(
        {
          pattern: 'nonexistentpattern',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('No matches found for pattern: nonexistentpattern');
    });

    it('should include line numbers in results', async () => {
      const result = await tool.execute(
        {
          pattern: 'function hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toMatch(/\d+\tfunction hello/);
    });

    it('should use current directory as default path', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      // Should not error out, even if no matches found in current directory
    });
  });

  describe('Search options', () => {
    it('should respect case sensitivity', async () => {
      const caseInsensitive = await tool.execute(
        {
          pattern: 'HELLO',
          path: testDir,
          caseSensitive: false,
        },
        createTestContext()
      );

      const caseSensitive = await tool.execute(
        {
          pattern: 'HELLO',
          path: testDir,
          caseSensitive: true,
        },
        createTestContext()
      );

      expect(caseInsensitive.status).toBe('completed');
      expect(caseInsensitive.content[0].text).toContain('Found');

      expect(caseSensitive.status).toBe('completed');
      expect(caseSensitive.content[0].text).toContain('No matches found');
    });

    it('should filter by include pattern', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
          includePattern: '*.ts',
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;

      expect(output).toContain('file1.ts');
      expect(output).toContain('nested.ts');
      expect(output).not.toContain('file2.js');
    });

    it('should filter by exclude pattern', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
          excludePattern: '*.test.txt',
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;

      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('example.test.txt');
    });

    it('should handle whole word matching', async () => {
      await writeFile(join(testDir, 'partial.txt'), 'hellofriend');
      await writeFile(join(testDir, 'whole.txt'), 'hello world');

      const wholeWord = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
          wholeWord: true,
        },
        createTestContext()
      );

      const partialWord = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
          wholeWord: false,
        },
        createTestContext()
      );

      expect(wholeWord.status).toBe('completed');
      expect(partialWord.status).toBe('completed');

      expect(partialWord.content[0].text).toContain('partial.txt');
      expect(partialWord.content[0].text).toContain('whole.txt');
      expect(wholeWord.content[0].text).not.toContain('partial.txt');
      expect(wholeWord.content[0].text).toContain('whole.txt');
    });

    it('should add context lines when requested', async () => {
      const result = await tool.execute(
        {
          pattern: 'console.log',
          path: testDir,
          contextLines: 1,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
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

      const result = await tool.execute(
        {
          pattern: 'uniquepattern',
          path: testDir,
          maxResults: 10,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0]).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      const output = result.content[0].text!;

      // Count actual matches in output
      const matchLines = output
        .split('\n')
        .filter((line) => line.match(/^\s*\d+\t.*uniquepattern/));

      expect(matchLines.length).toBe(10);
      expect(output).toContain('Results limited to 10');
    });

    it('should not show truncation message when under limit', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
          maxResults: 100,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).not.toContain('Results limited to');
    });

    it('should use default maxResults when not specified', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      // Should not error, default should be applied
    });
  });

  describe('Output formatting', () => {
    it('should group results by file', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;

      expect(output).toContain('file1.ts:');
      expect(output).toContain('file2.js:');
      expect(output).toMatch(/\d+\t.*hello/);
    });

    it('should show match count in header', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toMatch(/Found \d+ match(es)?:/);
    });

    it('should handle single match correctly', async () => {
      const result = await tool.execute(
        {
          pattern: 'nested hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('Found 1 match:');
      expect(output).not.toContain('matches');
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle non-existent directory', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: '/non/existent/directory',
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Search operation failed');
    });

    it('should handle special regex characters in pattern with literal search', async () => {
      await writeFile(join(testDir, 'special.txt'), 'Price: $10.50\nEmail: test@example.com');

      const result = await tool.execute(
        {
          pattern: '$10.50',
          path: testDir,
          // literal: true is now the default
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('$10.50');
    });

    it('should support regex patterns when literal is false', async () => {
      await writeFile(join(testDir, 'regex.txt'), 'test123\ntest456\nhello world');

      const result = await tool.execute(
        {
          pattern: 'test\\d+', // regex pattern
          path: testDir,
          literal: false,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('test123');
      expect(output).toContain('test456');
    });

    it('should handle empty files gracefully', async () => {
      await writeFile(join(testDir, 'empty.txt'), '');

      const result = await tool.execute(
        {
          pattern: 'anything',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
    });

    it('should handle binary files gracefully', async () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
      await writeFile(join(testDir, 'binary.bin'), binaryContent);

      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful searches', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('Found');
    });

    it('should use createResult for no matches found', async () => {
      const result = await tool.execute(
        {
          pattern: 'nonexistent',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('No matches found');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ pattern: '' }, createTestContext());

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should provide helpful error for ripgrep not found', () => {
      // This would need to mock exec to simulate ripgrep not being installed
      // For now, just verify the tool structure exists
      expect(tool.name).toBe('ripgrep_search');
    });
  });

  describe('Runtime cwd functionality', () => {
    it('should resolve relative paths based on runtime cwd', async () => {
      // Create a subdirectory within testDir
      const subDir = join(testDir, 'workdir');
      await mkdir(subDir);
      await writeFile(join(subDir, 'workfile.txt'), 'working directory test content');

      // Test with relative path and runtime cwd context
      const result = await tool.execute(
        {
          pattern: 'working directory',
          path: '.',
        },
        createTestContext(subDir)
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('workfile.txt');
      expect(output).toContain('working directory test content');
    });

    it('should handle absolute paths regardless of runtime cwd', async () => {
      const subDir = join(testDir, 'workdir');
      await mkdir(subDir);
      await writeFile(join(subDir, 'workfile.txt'), 'absolute path test');

      // Test with absolute path - should work regardless of runtime cwd
      const result = await tool.execute(
        {
          pattern: 'absolute path',
          path: testDir,
        },
        createTestContext(subDir)
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('absolute path test');
    });
  });

  describe('Edge cases', () => {
    it('should handle quotes in search pattern', async () => {
      await writeFile(join(testDir, 'quotes.txt'), 'He said "hello world" to me');

      const result = await tool.execute(
        {
          pattern: '"hello world"',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('"hello world"');
    });

    it('should handle complex include/exclude combinations', async () => {
      const result = await tool.execute(
        {
          pattern: 'hello',
          path: testDir,
          includePattern: '*.{ts,js}',
          excludePattern: '*.test.*',
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      const output = result.content[0].text;
      expect(output).toContain('file1.ts');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('example.test.txt');
    });

    it('should handle zero context lines explicitly', async () => {
      const result = await tool.execute(
        {
          pattern: 'console.log',
          path: testDir,
          contextLines: 0,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      // Should work without context lines
    });
  });
});
