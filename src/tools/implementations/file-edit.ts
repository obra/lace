// ABOUTME: Search and replace file content with exact string matching
// ABOUTME: Essential tool for precise code modifications and refactoring

import { writeFile } from 'fs/promises';
import { ToolCall, ToolResult, ToolContext, createSuccessResult } from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';

export class FileEditTool extends BaseTool {
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

    try {
      // Input validation using base class methods
      this.validateNonEmptyStringParam(path, 'path', call.id);
      this.validateStringParam(old_text, 'old_text', call.id);
      this.validateStringParam(new_text, 'new_text', call.id);

      // Read current content with enhanced error handling
      const content = await this.readFileWithContext(path, call.id);

      // Count occurrences
      const occurrences = content.split(old_text).length - 1;

      if (occurrences === 0) {
        // Enhanced error with file content preview
        const filePreview = this.createFilePreview(content, old_text);
        const error = this.createStructuredError(
          `No exact matches found for the specified text in ${path}`,
          'Use file_read to see the exact file content, then copy the text exactly including all whitespace, tabs, and line breaks',
          `File contains ${this.countLines(content)} lines. ${filePreview}`,
          call.id
        );
        throw new ValidationError(error);
      }

      if (occurrences > 1) {
        // Enhanced error with line number information
        const matchInfo = this.findMatchLocations(content, old_text);
        const error = this.createStructuredError(
          `Found ${occurrences} matches for the specified text in ${path}`,
          'Include more surrounding context (lines before/after) to make old_text unique',
          `Matches found at lines: ${matchInfo}. Include the entire function or block instead of just one line`,
          call.id
        );
        throw new ValidationError(error);
      }

      // Perform replacement
      const newContent = content.replace(old_text, new_text);

      // Write back with enhanced error handling
      await writeFile(path, newContent, 'utf-8');

      // Calculate line information for feedback
      const oldLines = this.countLines(old_text);
      const newLines = this.countLines(new_text);
      const lineInfo = this.formatLineChange(oldLines, newLines);

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
      if (error instanceof ValidationError) {
        return error.toolResult;
      }
      return this.createStructuredError(
        'Unknown error occurred',
        'Check the input parameters and try again',
        'File edit operation',
        call.id
      );
    }
  }

  /**
   * Creates a preview of file content around the expected match location
   */
  private createFilePreview(content: string, _searchText: string): string {
    const lines = content.split('\n');
    const totalLines = lines.length;

    if (totalLines <= 10) {
      return `File content preview:\n${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`;
    }

    // Show first few lines and last few lines for larger files
    const preview = lines.slice(0, 3).concat(['...'], lines.slice(-3)).join('\n');
    return `File content preview:\n${preview}`;
  }

  /**
   * Finds line numbers where matches occur
   */
  private findMatchLocations(content: string, searchText: string): string {
    const lines = content.split('\n');
    const matchLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines.slice(i).join('\n').startsWith(searchText)) {
        matchLines.push(i + 1);
      }
    }

    return matchLines.length > 0 ? matchLines.join(', ') : 'unknown';
  }

  /**
   * Formats line change information
   */
  private formatLineChange(oldLines: number, newLines: number): string {
    if (oldLines === newLines) {
      return `${oldLines} line${oldLines === 1 ? '' : 's'}`;
    }
    return `${oldLines} line${oldLines === 1 ? '' : 's'} → ${newLines} line${newLines === 1 ? '' : 's'}`;
  }
}
