// ABOUTME: Schema-based search and replace file content with exact string matching
// ABOUTME: Essential tool for precise code modifications with Zod validation and enhanced error handling

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Tool } from '../tool.js';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types.js';

const fileEditSchema = z.object({
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .transform((path) => resolve(path)),
  old_text: z.string(),
  new_text: z.string(),
});

export class FileEditTool extends Tool {
  name = 'file_edit';
  description = `Edit files by replacing exact text matches. 
For modifying existing code, configuration, or any file content.
Requires exact text matching including all whitespace and line breaks.
The old_text must appear exactly once in the file.`;
  schema = fileEditSchema;
  annotations: ToolAnnotations = {
    destructiveHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileEditSchema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { path, old_text, new_text } = args;

      // Read current content with enhanced error handling
      let content: string;
      try {
        content = await readFile(path, 'utf-8');
      } catch (error: unknown) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'ENOENT') {
          return this.createError(
            `File not found: ${path}. Ensure the file exists before editing. Check the file path and permissions.`
          );
        }
        throw error;
      }

      // Count occurrences
      const occurrences = content.split(old_text).length - 1;

      if (occurrences === 0) {
        // Enhanced error with file content preview
        const filePreview = this.createFilePreview(content, old_text);
        return this.createError(
          `No exact matches found for the specified text in ${path}. Use file_read to see the exact file content, then copy the text exactly including all whitespace, tabs, and line breaks. File contains ${this.countLines(content)} lines. ${filePreview}`
        );
      }

      if (occurrences > 1) {
        // Enhanced error with line number information
        const matchInfo = this.findMatchLocations(content, old_text);
        return this.createError(
          `Found ${occurrences} matches for the specified text in ${path}. Include more surrounding context (lines before/after) to make old_text unique. Matches found at lines: ${matchInfo}. Include the entire function or block instead of just one line.`
        );
      }

      // Perform replacement
      const newContent = content.replace(old_text, new_text);

      // Write back with enhanced error handling
      try {
        await writeFile(path, newContent, 'utf-8');
      } catch (error: unknown) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'EACCES') {
          return this.createError(
            `Permission denied writing to ${path}. Check file permissions or choose a different location. File system error: ${error.message}`
          );
        }
        throw error;
      }

      // Calculate line information for feedback
      const oldLines = this.countLines(old_text);
      const newLines = this.countLines(new_text);
      const lineInfo = this.formatLineChange(oldLines, newLines);

      return this.createResult(`Successfully replaced text in ${path} (${lineInfo})`);
    } catch (error: unknown) {
      return this.createError(
        `File edit operation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Check the input parameters and try again.`
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
   * Counts the number of lines in text
   */
  private countLines(text: string): number {
    if (text === '') return 0;
    return text.split('\n').length;
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
