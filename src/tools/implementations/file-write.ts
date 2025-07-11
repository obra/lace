// ABOUTME: Schema-based file writing tool with structured output
// ABOUTME: Safe file creation and modification with Zod validation and enhanced error handling

import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { Tool } from '~/tools/tool.js';
import { NonEmptyString } from '~/tools/schemas/common.js';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types.js';

const fileWriteSchema = z.object({
  path: NonEmptyString.transform((path) => resolve(path)),
  content: z.string(), // Allow empty content
  createDirs: z.boolean().default(true),
});

export class FileWriteTool extends Tool {
  name = 'file_write';
  description = 'Write content to a file, creating directories if needed';
  schema = fileWriteSchema;
  annotations: ToolAnnotations = {
    destructiveHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileWriteSchema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { path, content, createDirs } = args;

      // Create parent directories if requested
      if (createDirs) {
        const dir = dirname(path);
        await mkdir(dir, { recursive: true });
      }

      // Write the file
      await writeFile(path, content, 'utf-8');

      return this.createResult(
        `Successfully wrote ${this.formatFileSize(content.length)} to ${path}`
      );
    } catch (error: unknown) {
      return this.handleFileSystemError(error, args.path);
    }
  }

  private handleFileSystemError(error: unknown, filePath: string): ToolResult {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };

      switch (nodeError.code) {
        case 'EACCES':
          return this.createError(
            `Permission denied writing to ${filePath}. Check file permissions or choose a different location. File system error: ${error.message}`
          );

        case 'ENOENT':
          return this.createError(
            `Directory does not exist for path ${filePath}. Ensure parent directories exist or set createDirs to true. File system error: ${error.message}`
          );

        case 'ENOSPC':
          return this.createError(
            `Insufficient disk space to write file. Free up disk space and try again. File system error: ${error.message}`
          );

        case 'EISDIR':
          return this.createError(
            `Path ${filePath} is a directory, not a file. Specify a file path instead of a directory path.`
          );

        case 'EMFILE':
        case 'ENFILE':
          return this.createError(
            `Too many open files. Close some files and try again. File system error: ${error.message}`
          );

        default:
          return this.createError(
            `Failed to write file: ${error.message}. Check the file path and permissions, then try again.`
          );
      }
    }

    return this.createError(
      `Failed to write file due to unknown error. Check the file path and permissions, then try again.`
    );
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 bytes';
    if (bytes === 1) return '1 byte';
    if (bytes < 1024) return `${bytes} bytes`;

    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));

    return `${size} ${sizes[i]}`;
  }

  // Public method for testing
  validatePath(path: string): string {
    return resolve(path);
  }
}
