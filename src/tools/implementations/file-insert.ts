// ABOUTME: Insert content to files at specific lines or at the end
// ABOUTME: Supports both line-based insertion and end-of-file appending

import { writeFile } from 'fs/promises';
import { ToolCall, ToolResult, ToolContext, createSuccessResult } from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';

export class FileInsertTool extends BaseTool {
  name = 'file_insert';
  description = `Insert content into a file at a specific line or append to the end.
Preserves all existing content. Use for adding new functions, imports, or sections.
Line numbers are 1-based. If no line specified, appends to end of file.`;

  annotations = {
    destructiveHint: true,
  };

  inputSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to append to',
      },
      content: {
        type: 'string',
        description: 'Content to append (should include proper indentation)',
      },
      line: {
        type: 'number',
        description: 'Line number to insert after (1-based). If omitted, appends to end of file.',
      },
    },
    required: ['path', 'content'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const path = this.validateNonEmptyStringParam(call.arguments.path, 'path', call.id);
      const content = this.validateStringParam(call.arguments.content, 'content', call.id);
      const line = this.validateOptionalParam(
        call.arguments.line,
        'line',
        (value) => this.validateNumberParam(value, 'line', call.id, { min: 1, integer: true }),
        call.id
      );

      // Validate file exists and read content
      await this.validateFileExists(path, call.id);
      const currentContent = await this.readFileWithContext(path, call.id);
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
        this.validateLineNumber(line, currentContent, 'line', call.id);

        // Insert after the specified line
        lines.splice(line, 0, ...content.split('\n'));
        newContent = lines.join('\n');
        operation = `Inserted after line ${line}`;
      }

      // Write back
      await writeFile(path, newContent, 'utf-8');

      const addedLines = content.split('\n').length;

      return createSuccessResult(
        [
          {
            type: 'text',
            text: `${operation} in ${path} (+${addedLines} line${addedLines === 1 ? '' : 's'})`,
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
        if (nodeError.code === 'ENOSPC') {
          return this.createStructuredError(
            'Insufficient disk space to modify file',
            'Free up disk space and try again',
            `File system error: ${error.message}`,
            call.id
          );
        }
      }

      return this.createStructuredError(
        'File insertion failed',
        'Check the file path, permissions, and line number, then try again',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }
}
