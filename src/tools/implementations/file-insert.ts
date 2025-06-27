// ABOUTME: Insert content to files at specific lines or at the end
// ABOUTME: Supports both line-based insertion and end-of-file appending

import { readFile, writeFile } from 'fs/promises';
import { Tool, ToolCall, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

export class FileInsertTool implements Tool {
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
    const { path, content, line } = call.arguments as {
      path: string;
      content: string;
      line?: number;
    };

    // Input validation
    if (!path || typeof path !== 'string') {
      return createErrorResult('Path must be a non-empty string', call.id);
    }

    if (typeof content !== 'string') {
      return createErrorResult('Content must be a string', call.id);
    }

    if (line !== undefined && (typeof line !== 'number' || line < 1)) {
      return createErrorResult('Line must be a positive number (1-based)', call.id);
    }

    try {
      // Read current content
      const currentContent = await readFile(path, 'utf-8');
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
        // Insert at specific line
        if (line > lines.length) {
          return createErrorResult(`Line ${line} exceeds file length (${lines.length} lines)`, call.id);
        }

        // Insert after the specified line
        lines.splice(line, 0, ...content.split('\n'));
        newContent = lines.join('\n');
        operation = `Inserted after line ${line}`;
      }

      // Write back
      await writeFile(path, newContent, 'utf-8');

      const addedLines = content.split('\n').length;

      return createSuccessResult([
        {
          type: 'text',
          text: `${operation} in ${path} (+${addedLines} line${addedLines === 1 ? '' : 's'})`,
        },
      ], call.id);
    } catch (error) {
      return createErrorResult(error instanceof Error ? error.message : 'Unknown error occurred', call.id);
    }
  }
}
