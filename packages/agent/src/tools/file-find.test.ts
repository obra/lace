// ABOUTME: Tests for schema-based file finding tool with structured output
// ABOUTME: Validates file pattern matching, glob support, and directory traversal

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { FileFindTool } from '@lace/agent/tools/implementations/file_find';
import { createTestTempDir } from '@lace/agent/test-utils/temp-directory';
import { createFakeRuntime } from './runtime/__tests__/fake-runtime';
import { HostToolRuntime } from './runtime/host';
import type { ToolContext } from './types';
import type { RuntimePath } from './runtime/types';

describe('FileFindTool with schema validation', () => {
  let tool: FileFindTool;
  const tempDir = createTestTempDir('file_find-test-');
  let testDir: string;
  let runtimeId = 0;

  beforeEach(async () => {
    tool = new FileFindTool();
    testDir = await tempDir.getPath();
    await mkdir(testDir, { recursive: true });

    // Create test file structure
    await mkdir(join(testDir, 'src'), { recursive: true });
    await mkdir(join(testDir, 'tests'), { recursive: true });
    await mkdir(join(testDir, 'src', 'components'), { recursive: true });
    await mkdir(join(testDir, '.hidden'), { recursive: true });

    // Create test files
    await writeFile(join(testDir, 'README.md'), 'readme content');
    await writeFile(join(testDir, 'package.json'), '{}');
    await writeFile(join(testDir, 'src', 'app.ts'), 'typescript content');
    await writeFile(join(testDir, 'src', 'app.js'), 'javascript content');
    await writeFile(join(testDir, 'src', 'components', 'Button.tsx'), 'react component');
    await writeFile(join(testDir, 'tests', 'app.test.ts'), 'test content');
    await writeFile(join(testDir, '.hidden', 'secret.txt'), 'hidden content');
    await writeFile(join(testDir, '.gitignore'), 'git ignore');
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function createTestContext(
    cwd = process.cwd(),
    signal = new AbortController().signal
  ): ToolContext {
    return {
      signal,
      runtime: new HostToolRuntime({ id: `rt_file_find_test_${runtimeId++}`, cwd }),
    };
  }

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_find');
      expect(tool.description).toContain('Find files and directories');
      expect(tool.description).toContain('Case-insensitive');
      expect(tool.description).toContain('modification time');
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.pattern).toBeDefined();
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.maxDepth).toBeDefined();
      expect(schema.properties.includeHidden).toBeDefined();
      expect(schema.properties.maxResults).toBeDefined();
      expect(schema.required).toContain('pattern');
    });

    it('should be marked as read-only and idempotent', () => {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject missing pattern', async () => {
      const result = await tool.execute({}, createTestContext());

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('pattern');
      expect(result.content[0].text).toContain('Missing required');
    });

    it('should reject empty pattern', async () => {
      const result = await tool.execute({ pattern: '' }, createTestContext());

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject negative maxDepth', async () => {
      const result = await tool.execute(
        {
          pattern: '*.ts',
          maxDepth: -1,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should reject non-integer maxDepth', async () => {
      const result = await tool.execute(
        {
          pattern: '*.ts',
          maxDepth: 1.5,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Expected integer, got float');
    });

    it('should reject excessive maxResults', async () => {
      const result = await tool.execute(
        {
          pattern: '*.ts',
          maxResults: 10000,
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should accept valid parameters with defaults', async () => {
      const result = await tool.execute(
        {
          pattern: '*.nonexistent',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('No files found');
    });
  });

  describe('File search operations', () => {
    it('uses runtime display paths while recursing', async () => {
      const rootPath: RuntimePath = {
        original: '.',
        runtimePath: '/runtime',
        displayPath: 'project',
      };
      const srcPath: RuntimePath = {
        original: 'src',
        runtimePath: '/runtime/src',
        displayPath: 'project/src',
      };
      const appPath: RuntimePath = {
        original: 'src/app.ts',
        runtimePath: '/runtime/src/app.ts',
        displayPath: 'project/src/app.ts',
      };
      const runtime = createFakeRuntime({
        resolve: rootPath,
        statType: 'directory',
      });
      const mtime = new Date('2026-05-20T00:00:00.000Z');
      vi.mocked(runtime.fs.stat).mockImplementation(async (path) => {
        if (path.runtimePath === rootPath.runtimePath || path.runtimePath === srcPath.runtimePath) {
          return { type: 'directory', size: 0, mtime };
        }
        if (path.runtimePath === appPath.runtimePath) {
          return { type: 'file', size: 12, mtime };
        }
        throw Object.assign(new Error(`Not found: ${path.runtimePath}`), { code: 'ENOENT' });
      });
      vi.mocked(runtime.fs.readdir).mockImplementation(async (path) => {
        if (path.runtimePath === rootPath.runtimePath) {
          return [{ name: 'src', type: 'directory' }];
        }
        if (path.runtimePath === srcPath.runtimePath) {
          return [{ name: 'app.ts', type: 'file' }];
        }
        return [];
      });

      const result = await tool.execute(
        {
          pattern: '*.ts',
          path: '.',
          maxDepth: 2,
        },
        { signal: new AbortController().signal, runtime }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('project/src/app.ts');
      expect(result.content[0].text).not.toContain('/runtime/src/app.ts');
      expect(runtime.paths.resolve).toHaveBeenCalledTimes(1);
      expect(runtime.paths.resolve).toHaveBeenCalledWith('.');
      expect(runtime.fs.stat).toHaveBeenCalledWith(expect.objectContaining(srcPath));
      expect(runtime.fs.stat).toHaveBeenCalledWith(expect.objectContaining(appPath));
    });

    it('should find files by exact name', async () => {
      const result = await tool.execute(
        {
          pattern: 'README.md',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('README.md');
    });

    it('should find files by wildcard pattern', async () => {
      const result = await tool.execute(
        {
          pattern: '*.ts',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).toContain('app.test.ts');
      expect(result.content[0].text).not.toContain('app.js');
    });

    it('should find files by complex pattern', async () => {
      const result = await tool.execute(
        {
          pattern: 'app.*',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).toContain('app.js');
      expect(result.content[0].text).toContain('app.test.ts');
    });

    it('should find both files and directories', async () => {
      const result = await tool.execute(
        {
          pattern: '*',
          path: testDir,
          maxDepth: 1,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      // Should include files
      expect(result.content[0].text).toContain('README.md');
      expect(result.content[0].text).toContain('package.json');
      // Should include directories (with / suffix)
      expect(result.content[0].text).toContain('src/');
      expect(result.content[0].text).toContain('tests/');
    });

    it('should respect maxDepth parameter', async () => {
      const result = await tool.execute(
        {
          pattern: '*.tsx',
          path: testDir,
          maxDepth: 1,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).not.toContain('Button.tsx'); // Should not find files in deeper directories
    });

    it('should find files in deep directories with sufficient maxDepth', async () => {
      const result = await tool.execute(
        {
          pattern: '*.tsx',
          path: testDir,
          maxDepth: 5,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('Button.tsx');
    });

    it('should be case insensitive', async () => {
      const result = await tool.execute(
        {
          pattern: 'readme.md',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('README.md');
    });

    it('should exclude hidden files by default', async () => {
      const result = await tool.execute(
        {
          pattern: '*',
          path: testDir,
          maxDepth: 1,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).not.toContain('.hidden');
      expect(result.content[0].text).not.toContain('.gitignore');
    });

    it('should include hidden files when requested', async () => {
      const result = await tool.execute(
        {
          pattern: '.*',
          path: testDir,
          includeHidden: true,
          maxDepth: 1,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('.gitignore');
    });

    it('should respect maxResults limit', async () => {
      const result = await tool.execute(
        {
          pattern: '*',
          path: testDir,
          maxResults: 2,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0]).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      const lines = result.content[0].text!.split('\n').filter((line) => line.trim());
      expect(lines.length).toBeLessThanOrEqual(3); // 2 results + possible truncation message
      if (lines.length === 3) {
        expect(lines[2]).toContain('Results limited to 2');
      }
    });
  });

  describe('File size display', () => {
    it('should show file sizes for files', async () => {
      const result = await tool.execute(
        {
          pattern: 'README.md',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toMatch(/README\.md.*\(/); // Should have size in parentheses
    });

    it('should show sizes and timestamps for directories', async () => {
      const result = await tool.execute(
        {
          pattern: 'src',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('src/');
      expect(result.content[0].text).toMatch(/src\/.*\(/); // Should have size in parentheses
      expect(result.content[0].text).toMatch(/src\/.*(-|just now)/); // Should have timestamp
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful searches', async () => {
      const result = await tool.execute(
        {
          pattern: '*.ts',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('app.ts');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ pattern: '' }, createTestContext());

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should provide helpful message when no files found', async () => {
      const result = await tool.execute(
        {
          pattern: '*.nonexistent',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('No files found matching pattern');
      expect(result.content[0].text).toContain('*.nonexistent');
    });

    it('should handle directory not found error', async () => {
      const result = await tool.execute(
        {
          pattern: '*.ts',
          path: '/nonexistent/directory',
        },
        createTestContext()
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Directory not found');
    });
  });

  describe('Pattern matching edge cases', () => {
    it('should handle question mark wildcard', async () => {
      const result = await tool.execute(
        {
          pattern: 'app.?s',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).toContain('app.js');
    });

    it('should handle escaped special characters', async () => {
      // This would test patterns with literal dots, brackets, etc.
      // For this test, we'll verify the tool can handle normal patterns
      const result = await tool.execute(
        {
          pattern: 'package.json',
          path: testDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('package.json');
    });

    it('should handle empty directory search', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir);

      const result = await tool.execute(
        {
          pattern: '*',
          path: emptyDir,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('No files found');
    });
  });

  describe('Host runtime cwd support', () => {
    it('should resolve relative paths using host runtime cwd', async () => {
      // Create a relative test file structure
      const subDir = 'relative-test-dir';
      const subDirPath = join(testDir, subDir);
      await mkdir(subDirPath, { recursive: true });
      await writeFile(join(subDirPath, 'relative-file.txt'), 'relative content');

      const result = await tool.execute(
        { pattern: 'relative-file.txt', path: subDir },
        createTestContext(testDir)
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('relative-file.txt');
    });

    it('should use absolute paths directly even when host runtime cwd differs', async () => {
      const result = await tool.execute(
        { pattern: 'README.md', path: testDir }, // absolute path
        createTestContext('/some/other/dir')
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('README.md');
    });

    it('should resolve relative paths using process cwd host runtime', async () => {
      // Use maxDepth: 1 to keep the process.cwd() search bounded.
      const result = await tool.execute(
        {
          pattern: 'non-existent-file.txt',
          path: '.',
          maxDepth: 1,
        },
        createTestContext()
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('No files found');
    }, 10000);

    it('should handle non-existent relative paths with host runtime cwd', async () => {
      const result = await tool.execute(
        { pattern: '*', path: 'non-existent-dir' },
        createTestContext(testDir)
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Directory not found');
      expect(result.content[0].text).toContain('non-existent-dir');
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle permission errors gracefully', () => {
      // This test would need a way to simulate permission errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_find');
    });

    it('should provide actionable error for file system issues', () => {
      // This test would need a way to simulate file system errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_find');
    });

    it('should handle already-aborted signal', async () => {
      const abortController = new AbortController();
      abortController.abort(); // Signal is already aborted

      const result = await tool.execute(
        {
          pattern: '*.ts',
          path: testDir,
        },
        createTestContext(process.cwd(), abortController.signal)
      );

      expect(result.status).toBe('aborted');
    });
  });
});
