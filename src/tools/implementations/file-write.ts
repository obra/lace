// ABOUTME: File writing tool for creating and modifying files
// ABOUTME: Destructive operation that creates or overwrites files

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import {
  ToolCall,
  ToolResult,
  ToolContext,
  createSuccessResult,
} from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';

export class FileWriteTool extends BaseTool {
  name = 'file_write';
  description = 'Write content to a file, creating directories if needed';
  annotations = {
    destructiveHint: true,
  };
  inputSchema = {
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

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const path = this.validateNonEmptyStringParam(call.arguments.path, 'path', call.id);
      const content = this.validateStringParam(call.arguments.content, 'content', call.id);
      const createDirs = this.validateOptionalParam(
        call.arguments.createDirs,
        'createDirs',
        (value) => {
          if (typeof value !== 'boolean') {
            throw new Error(`Expected boolean, received ${typeof value}`);
          }
          return value;
        },
        call.id
      ) ?? true;

      if (createDirs) {
        const dir = dirname(path);
        await mkdir(dir, { recursive: true });
      }

      await writeFile(path, content, 'utf-8');

      return createSuccessResult(
        [
          {
            type: 'text',
            text: `Successfully wrote ${this.formatFileSize(content.length)} to ${path}`,
          },
        ],
        call.id
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        return error.toolResult;
      }
      
      if (error instanceof Error) {
        const nodeError = error as Error & { code?: string };
        if (nodeError.code === 'EACCES') {
          return this.createStructuredError(
            `Permission denied writing to ${call.arguments.path}`,
            'Check file permissions or choose a different location',
            `File system error: ${error.message}`,
            call.id
          );
        }
        if (nodeError.code === 'ENOENT') {
          return this.createStructuredError(
            `Directory does not exist for path ${call.arguments.path}`,
            'Ensure parent directories exist or set createDirs to true',
            `File system error: ${error.message}`,
            call.id
          );
        }
        if (nodeError.code === 'ENOSPC') {
          return this.createStructuredError(
            'Insufficient disk space to write file',
            'Free up disk space and try again',
            `File system error: ${error.message}`,
            call.id
          );
        }
      }

      return this.createStructuredError(
        'Failed to write file',
        'Check the file path and permissions, then try again',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }
}
