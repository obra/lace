// ABOUTME: File writing tool for creating and modifying files
// ABOUTME: Destructive operation that creates or overwrites files

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Tool, ToolResult, ToolContext } from '../types.js';

export class FileWriteTool implements Tool {
  name = 'file_write';
  description = 'Write content to a file, creating directories if needed';
  destructive = true;
  input_schema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path to write to' },
      content: { type: 'string', description: 'Content to write to the file' },
      createDirs: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist (default: true)',
      },
    },
    required: ['path', 'content'],
  };

  async executeTool(input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const {
      path,
      content,
      createDirs = true,
    } = input as {
      path: string;
      content: string;
      createDirs?: boolean;
    };

    if (!path || typeof path !== 'string') {
      return {
        success: false,
        content: [],
        error: 'Path must be a non-empty string',
      };
    }

    if (typeof content !== 'string') {
      return {
        success: false,
        content: [],
        error: 'Content must be a string',
      };
    }

    try {
      if (createDirs) {
        const dir = dirname(path);
        await mkdir(dir, { recursive: true });
      }

      await writeFile(path, content, 'utf-8');

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: `Successfully wrote ${content.length} characters to ${path}`,
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
