// ABOUTME: File reading tool with schema-based validation and line range support
// ABOUTME: Safe file access with AI-optimized error messages and misspelling suggestions

import { z } from 'zod';
import { readFile, stat } from 'fs/promises';
import { Tool } from '../tool.js';
import { FilePath, LineNumber } from '../schemas/common.js';
import type { ToolResult, ToolContext } from '../types.js';
import { findSimilarPaths } from '../utils/file-suggestions.js';

const MAX_FILE_SIZE = 32 * 1024; // 32KB limit for whole file reads
const MAX_RANGE_SIZE = 100; // Maximum lines in a ranged read

const fileReadSchema = z
  .object({
    path: FilePath,
    startLine: LineNumber.optional(),
    endLine: LineNumber.optional(),
  })
  .refine(
    (data) => {
      if (data.startLine && data.endLine) {
        return data.endLine >= data.startLine;
      }
      return true;
    },
    {
      message: 'endLine must be >= startLine',
      path: ['endLine'],
    }
  );

export class FileReadTool extends Tool {
  name = 'file_read';
  description = 'Read file contents with optional line range support';
  schema = fileReadSchema;
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileReadSchema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    try {
      // Check file size before reading (unless using line range)
      if (!args.startLine && !args.endLine) {
        const sizeError = await this.validateFileSizeForWholeRead(args.path);
        if (sizeError) {
          return {
            content: [{ type: 'text', text: sizeError }],
            isError: true,
          };
        }
      }

      // Validate range size if both start and end are specified
      if (args.startLine && args.endLine) {
        const rangeSize = args.endLine - args.startLine + 1;
        if (rangeSize > MAX_RANGE_SIZE) {
          return {
            content: [
              {
                type: 'text',
                text: `Range too large (${rangeSize} lines). Use smaller ranges (max ${MAX_RANGE_SIZE} lines per read) to avoid context overflow and performance issues.`,
              },
            ],
            isError: true,
          };
        }
      }

      // Read file content
      const content = await readFile(args.path, 'utf-8');
      const lines = content.split('\n');

      // Validate line numbers against actual file content
      if (args.startLine && args.startLine > lines.length) {
        return {
          content: [
            {
              type: 'text',
              text: `Line ${args.startLine} exceeds file length (${lines.length} lines). Use a line number between 1 and ${lines.length}.`,
            },
          ],
          isError: true,
        };
      }

      // Apply line range if specified
      let resultContent = content;
      let linesReturned = lines.length;

      if (args.startLine || args.endLine) {
        const start = Math.max(0, (args.startLine || 1) - 1);
        const end =
          args.endLine !== undefined ? Math.min(lines.length, args.endLine) : lines.length;

        const resultLines = lines.slice(start, end);
        resultContent = resultLines.join('\n');
        linesReturned = resultLines.length;
      }

      return {
        content: [
          {
            type: 'text',
            text: resultContent,
          },
        ],
        isError: false,
        metadata: {
          totalLines: lines.length,
          linesReturned,
          fileSize: this.formatFileSize(content.length),
        },
      };
    } catch (error: any) {
      // Handle file not found with helpful suggestions
      if (error.code === 'ENOENT') {
        const suggestions = await findSimilarPaths(args.path);
        const suggestionText =
          suggestions.length > 0 ? `\n\nSimilar files: ${suggestions.join(', ')}` : '';

        return {
          content: [
            {
              type: 'text',
              text: `File not found: ${args.path}${suggestionText}`,
            },
          ],
          isError: true,
        };
      }

      // Handle permission errors
      if (error.code === 'EACCES') {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied accessing file: ${args.path}. Check file permissions and try again.`,
            },
          ],
          isError: true,
        };
      }

      // Handle other file system errors
      if (error.code) {
        return {
          content: [
            {
              type: 'text',
              text: `File system error (${error.code}): ${error.message}. Check the file path and try again.`,
            },
          ],
          isError: true,
        };
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  private async validateFileSizeForWholeRead(filePath: string): Promise<string | null> {
    try {
      const fileStats = await stat(filePath);
      if (fileStats.size > MAX_FILE_SIZE) {
        const fileSizeFormatted = this.formatFileSize(fileStats.size);
        return `File is too large (${fileSizeFormatted}) for whole-file read. Use startLine and endLine parameters for ranged reads (e.g., startLine: 1, endLine: 100). File size limit is ${this.formatFileSize(
          MAX_FILE_SIZE
        )} for whole-file reads.`;
      }
      return null;
    } catch {
      // If we can't stat the file, let the main read operation handle the error
      return null;
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
}
