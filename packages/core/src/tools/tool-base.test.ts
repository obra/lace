// ABOUTME: Tests for base Tool class functionality
// ABOUTME: Tests path resolution and other common tool behaviors

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { join } from 'path';
import type { ToolResult, ToolContext } from '~/tools/types';

// Test tool implementation for testing base class functionality
class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool for base class functionality';
  schema = z.object({
    path: z.string(),
  });

  protected executeValidated(
    args: z.infer<typeof this.schema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(args.path, context);
    return Promise.resolve(this.createResult(`Resolved path: ${resolvedPath}`));
  }
}

describe('Tool base class', () => {
  const tool = new TestTool();

  describe('resolvePath method', () => {
    it('should return absolute paths as-is', async () => {
      const absolutePath = '/absolute/path/file.txt';
      const result = await tool.execute(
        { path: absolutePath },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe(`Resolved path: ${absolutePath}`);
    });

    it('should resolve relative paths using working directory from context', async () => {
      const relativePath = 'relative/file.txt';
      const workingDir = '/working/directory';
      const expected = join(workingDir, relativePath);

      const result = await tool.execute(
        { path: relativePath },
        { signal: new AbortController().signal, workingDirectory: workingDir }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe(`Resolved path: ${expected}`);
    });

    it('should resolve relative paths using process.cwd() when no working directory', async () => {
      const relativePath = 'relative/file.txt';
      const expected = join(process.cwd(), relativePath);

      const result = await tool.execute(
        { path: relativePath },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe(`Resolved path: ${expected}`);
    });

    it('should resolve relative paths using process.cwd() when context is undefined', async () => {
      const relativePath = 'relative/file.txt';
      const expected = join(process.cwd(), relativePath);

      const result = await tool.execute(
        { path: relativePath },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe(`Resolved path: ${expected}`);
    });
  });
});
