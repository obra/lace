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

export interface FileEditDiffContext {
  beforeContext: string;
  afterContext: string;
  oldContent: string;
  newContent: string;
  startLine: number;
}

interface MatchLocation {
  line_number: number;
  column_start: number;
  column_end: number;
  line_content: string;
  context_before?: string;
  context_after?: string;
}

interface _ValidationError {
  type: 'NO_MATCH' | 'WRONG_COUNT' | 'FILE_NOT_FOUND' | 'BINARY_FILE' | 'PERMISSION_DENIED';
  edit_index: number;
  total_edits: number;
  message: string;

  // For occurrence errors
  expected_occurrences?: number;
  actual_occurrences?: number;
  match_locations?: MatchLocation[];

  // For no match errors
  search_text?: string;
}

export class FileEditTool extends Tool {
  name = 'file_edit';
  description = `Edit files by making precise text replacements with occurrence validation

* All edits are applied atomically - if any edit fails validation, no changes are made
* Each edit replaces old_text with new_text exactly once by default
* Use file_read first to see exact content, then copy text precisely

Notes for the edits parameter:
* The old_text must match EXACTLY one or more consecutive lines from the file. Be mindful of whitespaces!
* If old_text is not unique in the file, specify occurrences: N to replace exactly N instances
* Include enough context in old_text to make it unique if there are multiple similar lines
* Use dry_run: true to preview changes before applying them

Example:
[
  { "old_text": "if (user.isActive) {\\n  return user.name;\\n}", "new_text": "if (user.isActive && user.verified) {\\n  return \`\${user.firstName} \${user.lastName}\`;\\n}" },
  { "old_text": "console.log('debug')", "new_text": "// console.log('debug')", "occurrences": 5 },
  { "old_text": "\\t\\t  name:    'test'  ", "new_text": "\\t\\t  name: 'production'" }
]`;
  schema = fileEditArgsSchema;

  annotations: ToolAnnotations = {
    destructiveHint: true,
  };

  protected async executeValidated(args: FileEditArgs, context?: ToolContext): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(args.path, context);
    const edits = args.edits;

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
    const editResults: { occurrences: number; expectedOccurrences: number }[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const occurrences = this.countOccurrences(workingContent, edit.old_text);
      const expectedOccurrences = edit.occurrences ?? 1;
      editResults.push({ occurrences, expectedOccurrences });

      if (occurrences === 0) {
        const filePreview = this.getFilePreview(workingContent, edit.old_text);

        const errorMessage = `Edit ${i + 1} of ${edits.length}: Could not find exact text in ${args.path}.

Searched for (between >>>markers<<<):
>>>${edit.old_text}<<<

${filePreview}

Suggestions:
1. Use file_read to see the exact content, then copy it precisely
2. Check for tabs vs spaces - copy the exact whitespace from the file
3. Ensure you include all line breaks in multi-line searches
4. Match the exact case from the file`;

        return this.createError(errorMessage, {
          validation_error: {
            type: 'NO_MATCH' as const,
            edit_index: i,
            total_edits: edits.length,
            message: errorMessage,
            search_text: edit.old_text,
          },
        });
      }

      if (occurrences !== expectedOccurrences) {
        const locations = this.findMatchLocations(workingContent, edit.old_text);
        const suggestedFixes = [
          {
            type: 'ADJUST_COUNT',
            suggestion: `Update occurrences to ${occurrences} if you want to replace all instances`,
            example: `occurrences: ${occurrences}`,
          },
          {
            type: 'USE_EXACT_TEXT',
            suggestion: 'Add more context to make old_text unique to just the instances you want',
            example: 'Include the entire function or block instead of just one line',
          },
        ];

        const errorMessage = `Edit ${i + 1} of ${edits.length}: Expected ${expectedOccurrences} occurrence${expectedOccurrences === 1 ? '' : 's'} but found ${occurrences}

Found '${edit.old_text}' at:
${locations.map((loc) => `  Line ${loc.line_number}, column ${loc.column_start}: "${loc.line_content}"`).join('\n')}

Options to fix:
${suggestedFixes.map((fix, idx) => `${idx + 1}. ${fix.suggestion}`).join('\n')}`;

        return this.createError(errorMessage, {
          validation_error: {
            type: 'WRONG_COUNT' as const,
            edit_index: i,
            total_edits: edits.length,
            message: errorMessage,
            expected_occurrences: expectedOccurrences,
            actual_occurrences: occurrences,
            match_locations: locations,
          },
        });
      }

      // Simulate the edit for next validation
      workingContent = this.replaceAll(workingContent, edit.old_text, edit.new_text);
    }

    // Apply all edits
    workingContent = content;
    for (const edit of edits) {
      workingContent = this.replaceAll(workingContent, edit.old_text, edit.new_text);
    }

    const newContent = workingContent;

    // Extract diff context - use full file diff for multi-edit, localized for single edit
    const diffContext =
      edits.length === 1
        ? this.extractDiffContext(content, edits[0].old_text, edits[0].new_text)
        : this.extractFullFileDiffContext(content, newContent, args.path);

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

    return this.createResult(
      `Successfully applied ${edits.length} edit${edits.length === 1 ? '' : 's'}`,
      {
        diff: diffContext,
        path: args.path,
        edits_applied: edits.map((edit, index) => ({
          old_text: edit.old_text,
          new_text: edit.new_text,
          occurrences_replaced: editResults[index]?.occurrences ?? 0,
        })),
        total_replacements: editResults.reduce((sum, result) => sum + result.occurrences, 0),
      }
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

  /**
   * Extracts diff context showing the complete file transformation
   * This shows all changes made across the entire file, not just one edit
   */
  private extractFullFileDiffContext(
    originalContent: string,
    newContent: string,
    _filePath?: string
  ): FileEditDiffContext {
    // For multi-edit operations, we want to show the complete transformation
    // So we use the entire original and new file contents
    return {
      beforeContext: '',
      afterContext: '',
      oldContent: originalContent,
      newContent: newContent,
      startLine: 1,
    };
  }

  /**
   * Finds line numbers and details where matches occur
   */
  private findMatchLocations(content: string, searchText: string): MatchLocation[] {
    const lines = content.split('\n');
    const locations: MatchLocation[] = [];

    for (let i = 0; i < lines.length; i++) {
      let columnIndex = 0;
      while ((columnIndex = lines[i].indexOf(searchText, columnIndex)) !== -1) {
        locations.push({
          line_number: i + 1,
          column_start: columnIndex + 1,
          column_end: columnIndex + searchText.length + 1,
          line_content: lines[i],
          context_before: i > 0 ? lines[i - 1] : undefined,
          context_after: i < lines.length - 1 ? lines[i + 1] : undefined,
        });
        columnIndex += searchText.length;
      }
    }

    return locations;
  }

  /**
   * Gets a simple preview of file content to help with debugging
   */
  private getFilePreview(content: string, _searchText?: string): string {
    const lines = content.split('\n');
    const totalLines = lines.length;

    if (totalLines <= 10) {
      // Small file - show everything with line numbers
      return `File content (${totalLines} lines):\n${lines.map((line, i) => `${i + 1}: ${line}`).join('\n')}`;
    }

    // Large file - show first few lines and summary
    const preview = lines
      .slice(0, 5)
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
    return `File preview (${totalLines} lines total):\n${preview}\n... (${totalLines - 5} more lines)\n\nUse file_read to see the complete file content.`;
  }

  /**
   * Count occurrences without creating large intermediate arrays
   */
  private countOccurrences(text: string, searchText: string): number {
    if (searchText === '') {
      return text === '' ? 1 : 0;
    }

    let count = 0;
    let pos = 0;

    while ((pos = text.indexOf(searchText, pos)) !== -1) {
      count++;
      pos += searchText.length;
    }

    return count;
  }

  /**
   * Replace all occurrences without creating large intermediate arrays
   */
  private replaceAll(text: string, searchText: string, replaceText: string): string {
    if (searchText === '') {
      return text === '' ? replaceText : text;
    }

    let result = '';
    let lastPos = 0;
    let pos = 0;

    while ((pos = text.indexOf(searchText, lastPos)) !== -1) {
      result += text.slice(lastPos, pos) + replaceText;
      lastPos = pos + searchText.length;
    }

    result += text.slice(lastPos);
    return result;
  }
}
