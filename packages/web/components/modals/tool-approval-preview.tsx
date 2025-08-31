// ABOUTME: Tool approval preview utilities for creating mock results and partial diffs
// ABOUTME: Transforms tool arguments into visual previews using existing renderer infrastructure

import type { FileDiff, DiffChunk, DiffLine } from '@/components/files/FileDiffViewer';
import type { ToolResult } from '@/components/timeline/tool/types';
import { detectLanguageFromPath } from '@/components/files/FileDiffViewer.utils';

/**
 * Creates a partial diff from file_edit arguments showing each edit operation
 * as a contextless before/after comparison
 */
export function createPartialDiff(toolName: string, args: unknown): FileDiff | null {
  if (toolName === 'file_edit' && typeof args === 'object' && args !== null) {
    const editArgs = args as {
      path?: string;
      edits?: Array<{ old_text: string; new_text: string }>;
      old_string?: string;
      new_string?: string;
    };

    // Handle both multi-edit format and single edit format
    let edits: Array<{ old_text: string; new_text: string }> = [];

    if (editArgs.edits && editArgs.edits.length > 0) {
      edits = editArgs.edits;
    } else if (editArgs.old_string && editArgs.new_string) {
      edits = [{ old_text: editArgs.old_string, new_text: editArgs.new_string }];
    }

    if (edits.length === 0) return null;

    // Create a FileDiff showing each edit as a separate chunk
    const chunks: DiffChunk[] = edits.map((edit, index) => {
      const lines: DiffLine[] = [];

      // Split multiline edits into separate lines for better visualization
      const oldLines = edit.old_text.split('\n');
      const newLines = edit.new_text.split('\n');

      // Add removed lines
      oldLines.forEach((line, lineIndex) => {
        lines.push({
          type: 'removed',
          oldLineNumber: index * 100 + lineIndex + 1, // Use artificial line numbers
          content: line,
        });
      });

      // Add added lines
      newLines.forEach((line, lineIndex) => {
        lines.push({
          type: 'added',
          newLineNumber: index * 100 + lineIndex + 1, // Use artificial line numbers
          content: line,
        });
      });

      return {
        oldStart: index * 100 + 1,
        oldCount: oldLines.length,
        newStart: index * 100 + 1,
        newCount: newLines.length,
        lines,
      };
    });

    const filePath = editArgs.path || 'file';

    return {
      oldFilePath: filePath,
      newFilePath: filePath,
      chunks,
      language: detectLanguageFromPath(filePath),
      // Add metadata to indicate this is a partial diff
      isPartialPreview: true,
    };
  }
  return null;
}

/**
 * Creates a mock ToolResult for approval preview based on tool arguments
 * This allows us to reuse existing tool renderers for approval display
 */
export function createPreviewResult(toolName: string, args: unknown): ToolResult {
  // Generate tool-specific preview text
  let previewText: string;

  switch (toolName.toLowerCase()) {
    case 'file_write':
      const writeArgs = args as { path?: string; content?: string };
      previewText = `Would write to ${writeArgs.path || 'file'}`;
      break;

    case 'file_edit':
      const editArgs = args as {
        path?: string;
        edits?: Array<{ old_text: string; new_text: string }>;
        old_string?: string;
        new_string?: string;
      };
      const editCount = editArgs.edits?.length || (editArgs.old_string ? 1 : 0);
      const filePath = editArgs.path || 'file';
      previewText = `Would apply ${editCount} edit${editCount === 1 ? '' : 's'} to ${filePath}`;
      break;

    case 'bash':
      const bashArgs = args as { command?: string; description?: string };
      previewText = `Would execute command: ${bashArgs.command || 'unknown command'}`;
      break;

    default:
      previewText = `Would execute ${toolName}`;
      break;
  }

  return {
    status: 'pending',
    content: [{ type: 'text', text: previewText }],
    metadata: {
      isPreview: true,
      arguments: args,
    },
  };
}

/**
 * Determines if a tool should show a partial diff preview (file_edit only)
 */
export function shouldShowPartialDiff(toolName: string): boolean {
  return toolName.toLowerCase() === 'file_edit';
}

// Extend FileDiff interface to support preview metadata
declare module '@/components/files/FileDiffViewer' {
  interface FileDiff {
    isPartialPreview?: boolean;
  }
}
