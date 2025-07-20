// ABOUTME: Schema-based file insertion tool with structured output
// ABOUTME: Safe content insertion at specific lines or end-of-file with Zod validation

import { z } from 'zod';
import { writeFile, readFile, stat } from 'fs/promises';
import { Tool } from '~/tools/tool';
import { FilePath, LineNumber } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';

const fileInsertSchema = z.object({
  path: FilePath,
  content: z.string(), // Allow empty content
  line: LineNumber.optional(),
});

export class FileInsertTool extends Tool {
  name = 'file_insert';
  description = `Insert content into a file at a specific line or append to the end.
Preserves all existing content. Use for adding new functions, imports, or sections.
Line numbers are 1-based. If no line specified, appends to end of file.`;
  schema = fileInsertSchema;
  annotations: ToolAnnotations = {
    destructiveHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileInsertSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { path, content, line } = args;
      const resolvedPath = this.resolvePath(path, context);

      // Validate file exists
      await stat(resolvedPath);

      // Read current content
      const currentContent = await readFile(resolvedPath, 'utf-8');
      const lines = currentContent.split('\n');

      let newContent: string;
      let operation: string;

      if (line === undefined) {
        // Append to end of file
        // Add newline if file doesn't end with one
        const needsNewline = currentContent.length > 0 && !currentContent.endsWith('\n');
        newContent = currentContent + (needsNewline ? '\n' : '') + content;
        operation = 'Appended to end of file';
      } else {
        // Validate line number against file content
        if (line > lines.length) {
          return this.createError(
            `Line number ${line} is out of range. File has ${lines.length} lines. Use a line number between 1 and ${lines.length}, or omit line to append to end.`
          );
        }

        // Insert after the specified line
        lines.splice(line, 0, ...content.split('\n'));
        newContent = lines.join('\n');
        operation = `Inserted after line ${line}`;
      }

      // Write back
      await writeFile(resolvedPath, newContent, 'utf-8');

      const addedLines = content.split('\n').length;

      return this.createResult(
        `${operation} in ${resolvedPath} (+${addedLines} line${addedLines === 1 ? '' : 's'})`
      );
    } catch (error: unknown) {
      return this.handleFileSystemError(error, args.path);
    }
  }

  private handleFileSystemError(error: unknown, filePath: string): ToolResult {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };

      switch (nodeError.code) {
        case 'ENOENT':
          return this.createError(
            `File not found: ${filePath}. Ensure the file exists before trying to insert content into it.`
          );

        case 'EACCES':
          return this.createError(
            `Permission denied writing to ${filePath}. Check file permissions or choose a different location. File system error: ${error.message}`
          );

        case 'ENOSPC':
          return this.createError(
            `Insufficient disk space to modify file. Free up disk space and try again. File system error: ${error.message}`
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
            `Failed to insert content: ${error.message}. Check the file path and permissions, then try again.`
          );
      }
    }

    return this.createError(
      `Failed to insert content due to unknown error. Check the file path and permissions, then try again.`
    );
  }

  // Public method for testing
  validatePath(path: string): string {
    return this.resolvePath(path);
  }
}
