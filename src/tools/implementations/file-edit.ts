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

interface SimilarContent {
  line_number: number;
  content: string;
  similarity_score: number;
  differences: StringDiff[];
}

interface StringDiff {
  type: 'whitespace' | 'case' | 'punctuation' | 'content';
  expected: string;
  found: string;
}

interface SuggestedFix {
  type: 'USE_EXACT_TEXT' | 'ADJUST_COUNT' | 'ESCAPE_SPECIAL' | 'CHECK_WHITESPACE';
  suggestion: string;
  example?: string;
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
  similar_content?: SimilarContent[];
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
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const occurrences = workingContent.split(edit.old_text).length - 1;
      const expectedOccurrences = edit.occurrences ?? 1;

      if (occurrences === 0) {
        const similarContent = this.findSimilarContent(workingContent, edit.old_text);
        const suggestedFixes = this.generateSuggestedFixes(edit.old_text, similarContent);

        const errorMessage = `Edit ${i + 1} of ${edits.length}: Could not find exact text in ${args.path}.

Searched for (between >>>markers<<<):
>>>${edit.old_text}<<<

${
  similarContent.length > 0
    ? `File contains similar content that might be what you're looking for:

${similarContent
  .map(
    (sc) => `Line ${sc.line_number}: ${sc.content}
  Difference: ${sc.differences.map((d) => `${d.type} - expected '${d.expected}', found '${d.found}'`).join(', ')}`
  )
  .join('\n\n')}

`
    : ''
}Suggestions:
${suggestedFixes.map((fix) => `${fix.suggestion}${fix.example ? '\n  Example: ' + fix.example : ''}`).join('\n')}`;

        return this.createError(errorMessage, {
          validation_error: {
            type: 'NO_MATCH' as const,
            edit_index: i,
            total_edits: edits.length,
            message: errorMessage,
            search_text: edit.old_text,
            similar_content: similarContent,
          },
        });
      }

      if (occurrences !== expectedOccurrences) {
        const locations = this.findMatchLocations(workingContent, edit.old_text);
        const suggestedFixes: SuggestedFix[] = [
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

    return this.createResult(
      `Successfully applied ${edits.length} edit${edits.length === 1 ? '' : 's'}`,
      {
        diff: diffContext,
        path: args.path,
        edits_applied: edits.map((edit) => ({
          old_text: edit.old_text,
          new_text: edit.new_text,
          occurrences_replaced: content.split(edit.old_text).length - 1,
        })),
        total_replacements: edits.reduce(
          (sum, edit) => sum + (content.split(edit.old_text).length - 1),
          0
        ),
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
   * Finds similar content to help with typos and near-matches
   */
  private findSimilarContent(content: string, searchText: string): SimilarContent[] {
    const lines = content.split('\n');
    const similar: SimilarContent[] = [];
    const threshold = 0.7; // Similarity threshold

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const similarity = this.calculateSimilarity(searchText, line);

      if (similarity >= threshold && similarity < 1.0) {
        const differences = this.findStringDifferences(searchText, line);
        similar.push({
          line_number: i + 1,
          content: line,
          similarity_score: similarity,
          differences,
        });
      }
    }

    // Sort by similarity descending and return top 3
    return similar.sort((a, b) => b.similarity_score - a.similarity_score).slice(0, 3);
  }

  /**
   * Calculates similarity between two strings using simple ratio
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculates Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(0) as number[]);

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // insertion
          matrix[j - 1][i] + 1, // deletion
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Finds specific differences between two strings
   */
  private findStringDifferences(expected: string, found: string): StringDiff[] {
    const differences: StringDiff[] = [];

    // Check for whitespace differences
    if (expected.trim() === found.trim() && expected !== found) {
      differences.push({
        type: 'whitespace',
        expected: expected.replace(/\s/g, '·'), // Show whitespace
        found: found.replace(/\s/g, '·'),
      });
    }

    // Check for case differences
    if (expected.toLowerCase() === found.toLowerCase() && expected !== found) {
      differences.push({
        type: 'case',
        expected,
        found,
      });
    }

    // If no specific type found, mark as content difference
    if (differences.length === 0) {
      differences.push({
        type: 'content',
        expected,
        found,
      });
    }

    return differences;
  }

  /**
   * Generates suggested fixes based on the error type and similar content
   */
  private generateSuggestedFixes(
    searchText: string,
    similarContent: SimilarContent[]
  ): SuggestedFix[] {
    const fixes: SuggestedFix[] = [
      {
        type: 'USE_EXACT_TEXT',
        suggestion: 'Use file_read to see the exact content, then copy it precisely',
        example: 'Include all whitespace, tabs, and line breaks exactly as they appear',
      },
    ];

    // Add specific suggestions based on similar content
    if (similarContent.length > 0) {
      const hasWhitespace = similarContent.some((sc) =>
        sc.differences.some((d) => d.type === 'whitespace')
      );
      const hasCase = similarContent.some((sc) => sc.differences.some((d) => d.type === 'case'));

      if (hasWhitespace) {
        fixes.push({
          type: 'CHECK_WHITESPACE',
          suggestion: 'Check for tabs vs spaces - copy the exact whitespace from the file',
        });
      }

      if (hasCase) {
        fixes.push({
          type: 'USE_EXACT_TEXT',
          suggestion: 'Check capitalization - match the exact case from the file',
        });
      }
    }

    return fixes;
  }
}
