// ABOUTME: File reading tool with schema-based validation and line range support
// ABOUTME: Safe file access with AI-optimized error messages and misspelling suggestions

import { z } from 'zod';
import { readFile, stat } from 'fs/promises';
import { Tool } from '~/tools/tool';
import { FilePath, LineNumber } from '~/tools/schemas/common';
import type { ToolResult, ToolContext } from '~/tools/types';
import { findSimilarPaths } from '~/tools/utils/file-suggestions';

const MAX_FILE_SIZE = 64 * 1024; // 64KB limit for whole file reads
const MAX_RANGE_SIZE = 2000; // Maximum lines in a ranged read

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
  description = `Read file contents using cat -n format, with line numbers starting at 1. Full reads limited to ${Math.floor(MAX_FILE_SIZE / 1024)}KB, use ranges of up to ${MAX_RANGE_SIZE} lines (startLine/endLine) for larger files. If you request more than ${MAX_RANGE_SIZE} lines, you'll get the first ${MAX_RANGE_SIZE} lines with metadata indicating truncation.`;
  schema = fileReadSchema;
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileReadSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    if (context.signal.aborted) {
      return this.createCancellationResult();
    }
    // Resolve path using working directory from context
    const resolvedPath = this.resolvePath(args.path, context);

    try {
      // Check file size before reading (unless using line range)
      if (!args.startLine && !args.endLine) {
        const sizeError = await this.validateFileSizeForWholeRead(resolvedPath);
        if (sizeError) {
          return this.createError(sizeError);
        }
      }

      // Read file content
      const content = await readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');

      // Validate line numbers against actual file content
      if (args.startLine && args.startLine > lines.length) {
        return this.createError(
          `Line ${args.startLine} exceeds file length (${lines.length} lines). Use a line number between 1 and ${lines.length}.`
        );
      }

      // Apply line range if specified
      let resultContent: string;
      let linesReturned: number;
      let startLineNum: number;
      let endLineNum: number;
      let wasTruncated = false;
      let requestedRange: { start: number; end: number } | undefined;

      if (args.startLine || args.endLine) {
        const start = Math.max(0, (args.startLine || 1) - 1);
        let end = args.endLine !== undefined ? Math.min(lines.length, args.endLine) : lines.length;

        // Check if requested range exceeds MAX_RANGE_SIZE
        const requestedSize = end - start;
        if (requestedSize > MAX_RANGE_SIZE) {
          wasTruncated = true;
          requestedRange = {
            start: args.startLine || 1,
            end: args.endLine || lines.length,
          };
          end = start + MAX_RANGE_SIZE;
        }

        const resultLines = lines.slice(start, end);
        startLineNum = start + 1;
        endLineNum = end;
        linesReturned = resultLines.length;

        // Add line numbers to output (cat -n format)
        const maxLineNum = startLineNum + resultLines.length - 1;
        const width = String(maxLineNum).length;
        resultContent = resultLines
          .map((line, idx) => {
            const lineNum = startLineNum + idx;
            return `${String(lineNum).padStart(width, ' ')}→${line}`;
          })
          .join('\n');
      } else {
        // Full file read - add line numbers (cat -n format)
        startLineNum = 1;
        endLineNum = lines.length;
        linesReturned = lines.length;
        const width = String(lines.length).length;
        resultContent = lines
          .map((line, idx) => `${String(idx + 1).padStart(width, ' ')}→${line}`)
          .join('\n');
      }

      const metadata: Record<string, unknown> = {
        totalLines: lines.length,
        linesReturned,
        range: { start: startLineNum, end: endLineNum },
        fileSize: this.formatFileSize(content.length),
      };

      if (wasTruncated && requestedRange) {
        metadata.warning = `Requested ${requestedRange.end - requestedRange.start + 1} lines (${requestedRange.start}-${requestedRange.end}), but limit is ${MAX_RANGE_SIZE}. Returned first ${MAX_RANGE_SIZE} lines (${startLineNum}-${endLineNum}). File has ${lines.length} total lines.`;
        metadata.truncated = true;
        metadata.requestedRange = requestedRange;
      }

      return this.createResult(resultContent, metadata);
    } catch (error: unknown) {
      // Type guard for Node.js filesystem errors
      const isNodeError = (err: unknown): err is { code: string; message: string } => {
        return (
          err instanceof Error &&
          'code' in err &&
          typeof (err as { code: unknown }).code === 'string'
        );
      };

      // Handle file not found with helpful suggestions
      if (isNodeError(error) && error.code === 'ENOENT') {
        const suggestions = await findSimilarPaths(resolvedPath);
        const suggestionText =
          suggestions.length > 0 ? `\n\nSimilar files: ${suggestions.join(', ')}` : '';

        return this.createError(`File not found: ${args.path}${suggestionText}`);
      }

      // Handle permission errors
      if (isNodeError(error) && error.code === 'EACCES') {
        return this.createError(
          `Permission denied accessing file: ${args.path}. Check file permissions and try again.`
        );
      }

      // Handle other file system errors
      if (isNodeError(error)) {
        return this.createError(
          `File system error (${error.code}): ${error.message}. Check the file path and try again.`
        );
      }

      // Return error for unexpected errors instead of throwing
      return this.createError(
        `Unexpected error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
