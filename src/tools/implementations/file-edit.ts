// ABOUTME: Search and replace file content with exact string matching
// ABOUTME: Essential tool for precise code modifications and refactoring

import { readFile, writeFile } from 'fs/promises';
import {
  Tool,
  ToolCall,
  ToolResult,
  ToolContext,
  createSuccessResult,
  createErrorResult,
} from '../types.js';

export class FileEditTool implements Tool {
  name = 'file_edit';
  description = `Edit files by replacing exact text matches. 
For modifying existing code, configuration, or any file content.
Requires exact text matching including all whitespace and line breaks.
The old_text must appear exactly once in the file.`;

  annotations = {
    destructiveHint: true,
  };

  inputSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to edit',
      },
      old_text: {
        type: 'string',
        description: 'Exact text to replace (must match exactly including whitespace)',
      },
      new_text: {
        type: 'string',
        description: 'Text to replace with',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    const { path, old_text, new_text } = call.arguments as {
      path: string;
      old_text: string;
      new_text: string;
    };

    // Input validation
    if (!path || typeof path !== 'string') {
      return createErrorResult('Path must be a non-empty string', call.id);
    }

    if (typeof old_text !== 'string') {
      return createErrorResult('old_text must be a string', call.id);
    }

    if (typeof new_text !== 'string') {
      return createErrorResult('new_text must be a string', call.id);
    }

    try {
      // Read current content
      const content = await readFile(path, 'utf-8');

      // Count occurrences
      const occurrences = content.split(old_text).length - 1;

      if (occurrences === 0) {
        return createErrorResult(
          `No exact matches found for the specified text in ${path}. 
SOLUTION: Use file_read to see the exact file content, then copy the text exactly including all whitespace, tabs, and line breaks. Even a single space difference will cause this error.`,
          call.id
        );
      }

      if (occurrences > 1) {
        return createErrorResult(
          `Found ${occurrences} matches for the specified text. 
SOLUTION: Include more surrounding context (lines before/after) to make old_text unique. For example, include the entire function or block instead of just one line.`,
          call.id
        );
      }

      // Perform replacement
      const newContent = content.replace(old_text, new_text);

      // Write back
      await writeFile(path, newContent, 'utf-8');

      // Calculate line information for feedback
      const oldLines = old_text.split('\n').length;
      const newLines = new_text.split('\n').length;
      const lineInfo =
        oldLines === newLines
          ? `${oldLines} line${oldLines === 1 ? '' : 's'}`
          : `${oldLines} line${oldLines === 1 ? '' : 's'} → ${newLines} line${newLines === 1 ? '' : 's'}`;

      return createSuccessResult(
        [
          {
            type: 'text',
            text: `Successfully replaced text in ${path} (${lineInfo})`,
          },
        ],
        call.id
      );
    } catch (error) {
      return createErrorResult(
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }
}
