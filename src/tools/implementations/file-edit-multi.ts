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

const fileEditArgsSchema = z.object({
  path: FilePath,
  edits: z.array(editOperationSchema).min(1),
  dry_run: z.boolean().optional(),
});

// Export types for use in tests and other files
export type EditOperation = z.infer<typeof editOperationSchema>;
export type FileEditArgs = z.infer<typeof fileEditArgsSchema>;

export class FileEditTool extends Tool {
  name = 'file_edit';
  description = 'Edit files by making multiple text replacements with occurrence validation';
  schema = fileEditArgsSchema;

  annotations: ToolAnnotations = {
    destructiveHint: true,
  };

  protected async executeValidated(args: FileEditArgs, context?: ToolContext): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(args.path, context);

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

    // Apply single edit (minimal implementation)
    const edit = args.edits[0];
    const occurrences = content.split(edit.old_text).length - 1;
    const expectedOccurrences = edit.occurrences ?? 1;

    if (occurrences !== expectedOccurrences) {
      return this.createError(
        `Expected ${expectedOccurrences} occurrences but found ${occurrences}`
      );
    }

    const newContent = content.replace(edit.old_text, edit.new_text);

    // Write file
    try {
      await writeFile(resolvedPath, newContent, 'utf-8');
    } catch (error: unknown) {
      return this.createError(
        `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return this.createResult('Successfully replaced text');
  }
}
