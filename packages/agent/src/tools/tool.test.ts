// ABOUTME: Tests for schema-based tool validation system
// ABOUTME: Ensures tools validate inputs and handle errors correctly

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Tool } from './tool';
import { ToolContext, ToolResult } from './types';
import { join } from 'path';

// Test implementation of new Tool class
class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool for validation';
  schema = z.object({
    required: z.string().min(1),
    optional: z.number().optional(),
  });

  protected executeValidated(
    args: z.infer<typeof this.schema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      content: [{ type: 'text' as const, text: `Got: ${args.required}` }],
      status: 'completed',
    });
  }
}

describe('Tool with schema validation', () => {
  it('validates and executes with valid parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { required: 'hello' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('handles optional parameters correctly', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { required: 'hello', optional: 42 },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('returns concise validation errors for invalid parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ optional: 123 }, { signal: new AbortController().signal }); // missing required field

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toBe(
      'ValidationError: test_tool failed\nMissing required: required'
    );
  });

  it('validates parameter types correctly', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { required: 'hello', optional: 'not-a-number' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('ValidationError: test_tool failed');
    expect(result.content[0].text).toContain('optional: Expected number, got string');
  });

  it('rejects empty strings for required string fields', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: '' }, { signal: new AbortController().signal });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('ValidationError: test_tool failed');
    expect(result.content[0].text).toContain('required: String must contain at least 1 character');
  });

  it('generates JSON schema from Zod schema', () => {
    const tool = new TestTool();
    const jsonSchema = tool.inputSchema;

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.required).toBeDefined();
    expect(jsonSchema.properties.optional).toBeDefined();
    expect(jsonSchema.required).toContain('required');
    expect(jsonSchema.required).not.toContain('optional');
  });

  it('provides concise error messages with type mismatches', async () => {
    const tool = new TestTool();
    const result = await tool.execute({ required: null }, { signal: new AbortController().signal });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('ValidationError: test_tool failed');
    expect(result.content[0].text).toContain('required: Expected string, got null');
  });

  it('handles unexpected parameters', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { required: 'hello', extra: 'param', another: 123 },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed'); // Zod strips unknown keys by default
    expect(result.content[0].text).toBe('Got: hello');
  });

  it('handles multiple validation errors concisely', async () => {
    const tool = new TestTool();
    const result = await tool.execute(
      { optional: 'not-a-number', extraField: 'unexpected' },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    const errorText = result.content[0].text;
    expect(errorText).toContain('ValidationError: test_tool failed');
    expect(errorText).toContain('Missing required: required');
    // Zod strips unknown keys, so extraField won't show as unexpected
    expect(errorText).toContain('optional: Expected number, got string');
  });
});

// Test complex validation scenarios
class ComplexTestTool extends Tool {
  name = 'complex_test';
  description = 'Tool with complex validation rules';
  schema = z
    .object({
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      content: z.string().min(1),
    })
    .refine(
      (data) => {
        return data.endLine >= data.startLine;
      },
      {
        message: 'endLine must be >= startLine',
        path: ['endLine'],
      }
    );

  protected executeValidated(
    _args: z.infer<typeof this.schema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      content: [{ type: 'text' as const, text: 'validation passed' }],
      status: 'completed',
    });
  }
}

describe('Tool with complex validation', () => {
  it('validates cross-field constraints', async () => {
    const tool = new ComplexTestTool();
    const result = await tool.execute(
      {
        startLine: 5,
        endLine: 3, // Invalid: end before start
        content: 'test',
      },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('endLine must be >= startLine');
  });

  it('passes when cross-field constraints are met', async () => {
    const tool = new ComplexTestTool();
    const result = await tool.execute(
      {
        startLine: 3,
        endLine: 5,
        content: 'test',
      },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('completed');
  });

  it('reports the correct path for cross-field validation errors', async () => {
    const tool = new ComplexTestTool();
    const result = await tool.execute(
      {
        startLine: 10,
        endLine: 5,
        content: 'test',
      },
      { signal: new AbortController().signal }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('endLine: endLine must be >= startLine');
  });
});

// Test tool for temp directory functionality
class TempDirectoryTestTool extends Tool {
  name = 'temp_dir_test_tool';
  description = 'Tool for testing temp directory functionality';
  schema = z.object({
    message: z.string(),
  });

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve(this.createResult(`Test executed: ${args.message}`));
  }

  // Expose protected methods for testing
  public getToolTempDirPublic(context?: ToolContext): string {
    return this.getToolTempDir(context);
  }

  public getOutputFilePathsPublic(context?: ToolContext) {
    // Use toolTempDir to create output file paths
    const toolTempDir = this.getToolTempDir(context);
    return {
      stdout: join(toolTempDir, 'stdout.txt'),
      stderr: join(toolTempDir, 'stderr.txt'),
      combined: join(toolTempDir, 'combined.txt'),
    };
  }
}

describe('Tool temp directory functionality', () => {
  let testTool: TempDirectoryTestTool;

  beforeEach(() => {
    testTool = new TempDirectoryTestTool();
  });

  it('should get output file paths from temp directory', () => {
    const context: ToolContext = {
      signal: new AbortController().signal,
      toolTempDir: '/tmp/test/tool-temp-dir',
    };

    const paths = testTool.getOutputFilePathsPublic(context);
    expect(paths.stdout).toBe('/tmp/test/tool-temp-dir/stdout.txt');
    expect(paths.stderr).toBe('/tmp/test/tool-temp-dir/stderr.txt');
    expect(paths.combined).toBe('/tmp/test/tool-temp-dir/combined.txt');
  });

  it('should throw error when temp directory not provided', () => {
    const context: ToolContext = {
      signal: new AbortController().signal,
      // No toolTempDir
    };

    expect(() => {
      testTool.getOutputFilePathsPublic(context);
    }).toThrow('Tool temp directory not provided by ToolExecutor');
  });

  it('should get tool temp dir from context', () => {
    const context: ToolContext = {
      signal: new AbortController().signal,
      toolTempDir: '/tmp/test/tool-call-123',
    };

    const tempDir = testTool.getToolTempDirPublic(context);
    expect(tempDir).toBe('/tmp/test/tool-call-123');
  });

  it('should throw error when tool temp dir not provided', () => {
    const context: ToolContext = {
      signal: new AbortController().signal,
      // No toolTempDir
    };

    expect(() => {
      testTool.getToolTempDirPublic(context);
    }).toThrow('Tool temp directory not provided by ToolExecutor');
  });
});

// Test tool for workspace path resolution
class WorkspacePathTestTool extends Tool {
  name = 'workspace_path_test_tool';
  description = 'Tool for testing workspace path resolution';
  schema = z.object({
    path: z.string(),
  });

  protected async executeValidated(
    _args: z.infer<typeof this.schema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve(this.createResult('Test executed'));
  }

  // Expose protected method for testing
  public resolveWorkspacePathPublic(path: string, context?: ToolContext): string {
    return this.resolveWorkspacePath(path, context);
  }
}

describe('Tool workspace path resolution security', () => {
  let testTool: WorkspacePathTestTool;
  const projectDir = '/home/user/project';
  const clonePath = '/tmp/workspace/clone';

  beforeEach(() => {
    testTool = new WorkspacePathTestTool();
  });

  describe('without workspace context', () => {
    it('should resolve relative paths against working directory', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workingDirectory: '/home/user/current',
      };

      const resolved = testTool.resolveWorkspacePathPublic('file.txt', context);
      expect(resolved).toBe(join('/home/user/current', 'file.txt'));
    });

    it('should pass through absolute paths unchanged', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
      };

      const resolved = testTool.resolveWorkspacePathPublic('/absolute/path/file.txt', context);
      expect(resolved).toBe('/absolute/path/file.txt');
    });
  });

  describe('with workspace context - absolute paths', () => {
    it('should translate absolute paths inside project to clone directory', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      const inputPath = join(projectDir, 'src', 'file.ts');
      const resolved = testTool.resolveWorkspacePathPublic(inputPath, context);
      expect(resolved).toBe(join(clonePath, 'src', 'file.ts'));
    });

    it('should reject absolute paths trying to escape project via parent references', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      // Try to escape using ../../ to go outside project
      const attackPath = join(projectDir, '..', '..', 'etc', 'passwd');

      expect(() => {
        testTool.resolveWorkspacePathPublic(attackPath, context);
      }).toThrow('Access denied: Path');
      expect(() => {
        testTool.resolveWorkspacePathPublic(attackPath, context);
      }).toThrow('outside the workspace directory');
    });

    it('should reject absolute paths completely outside project directory', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      expect(() => {
        testTool.resolveWorkspacePathPublic('/etc/passwd', context);
      }).toThrow('Access denied: Path');
      expect(() => {
        testTool.resolveWorkspacePathPublic('/etc/passwd', context);
      }).toThrow('outside the workspace directory');
    });
  });

  describe('with workspace context - relative paths', () => {
    it('should resolve relative paths against clone directory', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      const resolved = testTool.resolveWorkspacePathPublic('src/file.ts', context);
      expect(resolved).toBe(join(clonePath, 'src', 'file.ts'));
    });

    it('should reject relative paths with parent references that escape workspace', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      // Try classic path traversal attack
      const attackPath = '../'.repeat(10) + 'etc/passwd';

      expect(() => {
        testTool.resolveWorkspacePathPublic(attackPath, context);
      }).toThrow('Access denied: Path');
      expect(() => {
        testTool.resolveWorkspacePathPublic(attackPath, context);
      }).toThrow('resolves outside the workspace directory');
    });

    it('should reject paths with mixed slashes attempting traversal', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      // Try various obfuscation techniques
      const attackPaths = [
        './../../../etc/passwd',
        'src/../../../../../../etc/passwd',
        './../../../../../../etc/passwd',
      ];

      for (const attackPath of attackPaths) {
        expect(() => {
          testTool.resolveWorkspacePathPublic(attackPath, context);
        }).toThrow('Access denied');
      }
    });

    it('should allow relative paths with parent references that stay within workspace', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      // This should be fine - goes up and back down but stays within workspace
      const safePath = 'src/deep/nested/../../file.ts';
      const resolved = testTool.resolveWorkspacePathPublic(safePath, context);
      expect(resolved).toBe(join(clonePath, 'src', 'file.ts'));
    });
  });

  describe('path normalization', () => {
    it('should handle paths with redundant slashes', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      const weirdPath = 'src//deep///nested////file.ts';
      const resolved = testTool.resolveWorkspacePathPublic(weirdPath, context);
      expect(resolved).toBe(join(clonePath, 'src', 'deep', 'nested', 'file.ts'));
    });

    it('should handle paths with . (current directory) references', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      const dotPath = './src/./deep/./file.ts';
      const resolved = testTool.resolveWorkspacePathPublic(dotPath, context);
      expect(resolved).toBe(join(clonePath, 'src', 'deep', 'file.ts'));
    });
  });

  describe('edge cases', () => {
    it('should handle workspace at root of filesystem', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir: '/workspace',
          clonePath: '/tmp/clone',
          type: 'local',
        },
      };

      const resolved = testTool.resolveWorkspacePathPublic('/workspace/file.ts', context);
      expect(resolved).toBe('/tmp/clone/file.ts');
    });

    it('should handle empty relative path (current directory)', () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        workspaceInfo: {
          projectDir,
          clonePath,
          type: 'local',
        },
      };

      const resolved = testTool.resolveWorkspacePathPublic('.', context);
      expect(resolved).toBe(clonePath);
    });
  });
});
