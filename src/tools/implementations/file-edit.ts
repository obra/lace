// ABOUTME: Enhanced file_edit tool with multiple edits and occurrence validation
// ABOUTME: Supports atomic multi-edit operations with precise occurrence counting

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { Tool } from '~/tools/tool';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import { FilePath } from '~/tools/schemas/common';

// Define schemas for input validation
const editOperationSchema = z.object({
  old_text: z.string(),
  new_text: z.string(),
  occurrences: z.number().int().positive().optional(),
});

// Support both old and new API formats for backward compatibility
const fileEditArgsSchema = z.union([
  // New API with edits array
  z.object({
    path: FilePath,
    edits: z.array(editOperationSchema).min(1),
    dry_run: z.boolean().optional(),
  }),
  // Old API for backward compatibility
  z.object({
    path: FilePath,
    old_text: z.string(),
    new_text: z.string(),
    dry_run: z.boolean().optional(),
  }),
]);

// Export types for use in tests and other files
export type EditOperation = z.infer<typeof editOperationSchema>;
export type FileEditArgs = z.infer<typeof fileEditArgsSchema>;

export interface FileEditDiffContext {
  beforeContext: string;
  afterContext: string;
  oldContent: string;
  newContent: string;
  startLine: number;
}

export class FileEditTool extends Tool {
  name = 'file_edit';
  description = 'Edit files by making multiple text replacements with occurrence validation';
  schema = fileEditArgsSchema;

  annotations: ToolAnnotations = {
    destructiveHint: true,
  };

  protected async executeValidated(args: FileEditArgs, context?: ToolContext): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(args.path, context);

    // Convert old API format to new format for processing
    const edits: EditOperation[] =
      'edits' in args
        ? args.edits
        : [
            {
              old_text: args.old_text,
              new_text: args.new_text,
              occurrences: 1,
            },
          ];

    // Read file
    let content: string;
    try {
      content = await readFile(resolvedPath, 'utf-8');
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return this.createError(`File not found: ${args.path}`);
      }
      throw error;
    }

    // Validate all edits first
    let workingContent = content;
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const occurrences = workingContent.split(edit.old_text).length - 1;
      const expectedOccurrences = edit.occurrences ?? 1;

      if (occurrences === 0) {
        return this.createError(
          `Edit ${i + 1} of ${edits.length}: No matches found for "${edit.old_text}"`
        );
      }

      if (occurrences !== expectedOccurrences) {
        return this.createError(
          `Edit ${i + 1} of ${edits.length}: Expected ${expectedOccurrences} occurrences but found ${occurrences}`
        );
      }

      // Simulate the edit for next validation
      workingContent = workingContent.split(edit.old_text).join(edit.new_text);
    }

    // Apply all edits
    workingContent = content;
    for (const edit of edits) {
      workingContent = workingContent.split(edit.old_text).join(edit.new_text);
    }

    const newContent = workingContent;

    // Extract diff context for the first edit (for backward compatibility)
    const diffContext = this.extractDiffContext(content, edits[0].old_text, edits[0].new_text);

    // Dry run mode
    if (args.dry_run) {
      return this.createResult(
        `Dry run completed. Would apply ${edits.length} edit${edits.length === 1 ? '' : 's'} to ${args.path}`,
        {
          dry_run: true,
          would_modify: true,
          edits_to_apply: edits,
          diff: diffContext,
        }
      );
    }

    // Write file
    try {
      await writeFile(resolvedPath, newContent, 'utf-8');
    } catch (error: unknown) {
      return this.createError(
        `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Create metadata for backward compatibility
    const metadata = {
      diff: diffContext,
      path: args.path,
      ...(edits.length === 1 && {
        oldText: edits[0].old_text,
        newText: edits[0].new_text,
      }),
    };

    return this.createResult(
      `Successfully applied ${edits.length} edit${edits.length === 1 ? '' : 's'}`,
      metadata
    );
  }

  /**
   * Extracts context around the change for diff display
   */
  private extractDiffContext(
    fullContent: string,
    oldText: string,
    newText: string,
    contextLines: number = 3
  ): FileEditDiffContext {
    const lines = fullContent.split('\n');
    const matchIndex = fullContent.indexOf(oldText);

    if (matchIndex === -1) {
      // This shouldn't happen as we already validated the match exists
      return {
        beforeContext: '',
        afterContext: '',
        oldContent: fullContent,
        newContent: fullContent.replace(oldText, newText),
        startLine: 1,
      };
    }

    // Find the line number where the match starts
    const beforeMatch = fullContent.substring(0, matchIndex);
    const startLine = beforeMatch.split('\n').length;

    // Find the line number where the match ends
    const endOfMatch = matchIndex + oldText.length;
    const beforeEndMatch = fullContent.substring(0, endOfMatch);
    const endLine = beforeEndMatch.split('\n').length;

    // Extract context lines before the change
    const contextStartLine = Math.max(0, startLine - contextLines - 1);
    const beforeContext = lines.slice(contextStartLine, startLine - 1).join('\n');

    // Extract context lines after the change
    const contextEndLine = Math.min(lines.length, endLine + contextLines);
    const afterContext = lines.slice(endLine, contextEndLine).join('\n');

    // Build the full content with context for diff display
    const oldContent = [beforeContext, oldText, afterContext].filter(Boolean).join('\n');
    const newContent = [beforeContext, newText, afterContext].filter(Boolean).join('\n');

    return {
      beforeContext,
      afterContext,
      oldContent,
      newContent,
      startLine: contextStartLine + 1, // Convert to 1-based line numbering
    };
  }
}
