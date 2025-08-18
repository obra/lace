'use client';

// ABOUTME: File edit tool renderer with diff visualization
// ABOUTME: Displays file modifications using the FileDiffViewer component for clear before/after comparison

import React from 'react';
import { faFileEdit, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import FileDiffViewer from '@/components/files/FileDiffViewer';
import {
  createFileDiffFromText,
  detectLanguageFromPath,
} from '@/components/files/FileDiffViewer.utils';
import type { ToolRenderer, ToolResult } from './types';
import type { ToolAggregatedEventData } from '@/types/web-events';
import type { FileEditDiffContext } from '@/types/core';
import { Alert } from '@/components/ui/Alert';

/**
 * File edit-specific tool renderer providing diff visualization
 * for file modification operations
 */
export const fileEditRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null) {
      const argsObj = args as { path?: unknown; edits?: unknown[] };

      // Get the file path
      const path = typeof argsObj.path === 'string' ? argsObj.path : undefined;

      // Count the number of edits
      const editCount = Array.isArray(argsObj.edits) ? argsObj.edits.length : 1;

      if (path && editCount > 1) {
        return `Apply ${editCount} edits to ${path}`;
      } else if (path) {
        return `Edit ${path}`;
      }
    }
    return 'Edit file';
  },

  isError: (result: ToolResult): boolean => {
    // Check for error statuses (failed, denied) vs non-error (completed, aborted)
    return result.status === 'failed' || result.status === 'denied';
  },

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No output</em>
        </div>
      );
    }

    const content = result.content.map((block) => block.text || '').join('');

    const isError = fileEditRenderer.isError!(result);

    if (isError) {
      // Check for enhanced validation error metadata
      const validationError = result.metadata?.validation_error as
        | {
            type?: string;
            edit_index?: number;
            total_edits?: number;
            expected_occurrences?: number;
            actual_occurrences?: number;
            match_locations?: Array<{
              line_number: number;
              column_start: number;
              line_content: string;
            }>;
            similar_content?: Array<{
              line_number: number;
              content: string;
              similarity_score: number;
            }>;
          }
        | undefined;

      const errorTitle =
        validationError?.type === 'WRONG_COUNT'
          ? 'Occurrence Count Mismatch'
          : validationError?.type === 'NO_MATCH'
            ? 'Text Not Found'
            : 'Edit Failed';

      const errorDescription =
        validationError?.edit_index !== undefined
          ? `Edit ${validationError.edit_index + 1} of ${validationError.total_edits}: ${content}`
          : content;

      return (
        <Alert variant="error" title={errorTitle} description={errorDescription}>
          {/* Show match locations for WRONG_COUNT errors */}
          {validationError?.match_locations && validationError.match_locations.length > 0 && (
            <div className="bg-error/5 rounded border border-error/10 p-3">
              <h4 className="text-xs font-medium opacity-70 mb-2">Found at:</h4>
              <div className="space-y-1 text-xs font-mono">
                {validationError.match_locations.map((loc, i) => (
                  <div key={i} className="opacity-80">
                    <span className="opacity-60">Line {loc.line_number}:</span> {loc.line_content}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Show similar content for NO_MATCH errors */}
          {validationError?.similar_content && validationError.similar_content.length > 0 && (
            <div className="bg-warning/5 rounded border border-warning/10 p-3">
              <h4 className="text-xs font-medium text-warning/70 mb-2">Similar content found:</h4>
              <div className="space-y-1 text-xs font-mono">
                {validationError.similar_content.map((sim, i) => (
                  <div key={i} className="text-warning/80">
                    <span className="text-warning/60">
                      Line {sim.line_number} ({Math.round(sim.similarity_score * 100)}% similar):
                    </span>{' '}
                    {sim.content}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Alert>
      );
    }

    // Check if we have the enhanced metadata from the tool
    const resultMetadata = result.metadata as
      | {
          diff?: FileEditDiffContext;
          path?: string;
          edits_applied?: Array<{
            old_text: string;
            new_text: string;
            occurrences_replaced: number;
          }>;
          total_replacements?: number;
          dry_run?: boolean;
        }
      | undefined;

    // If we have the enhanced diff context, use it
    if (resultMetadata?.diff) {
      const { diff, path } = resultMetadata;
      const language = path ? detectLanguageFromPath(path) : undefined;

      // Create a FileDiff with the context-aware content
      const fileDiff = createFileDiffFromText(
        diff.oldContent,
        diff.newContent,
        path || 'file',
        language
      );

      // Adjust line numbers only for localized diffs (single edits with context)
      // For full file diffs (multi-edit), startLine is 1 and no adjustment needed
      if (diff.startLine > 1 && diff.beforeContext && fileDiff.chunks[0]) {
        const chunk = fileDiff.chunks[0];
        chunk.oldStart = diff.startLine;
        chunk.newStart = diff.startLine;

        // Update line numbers for all lines
        let oldLineNum = diff.startLine;
        let newLineNum = diff.startLine;

        chunk.lines.forEach((line) => {
          if (line.type === 'removed') {
            line.oldLineNumber = oldLineNum++;
          } else if (line.type === 'added') {
            line.newLineNumber = newLineNum++;
          } else {
            line.oldLineNumber = oldLineNum++;
            line.newLineNumber = newLineNum++;
          }
        });
      }

      // Show the diff with smart context collapsing
      const isMultiEdit = resultMetadata.edits_applied && resultMetadata.edits_applied.length > 1;

      return (
        <div className="bg-base-100/50">
          <FileDiffViewer
            diff={fileDiff}
            viewMode="unified"
            showLineNumbers={true}
            showFullFile={false}
            maxLines={isMultiEdit ? 40 : 20}
            className="shadow-sm"
          />
        </div>
      );
    }

    // Handle dry run mode
    if (resultMetadata?.dry_run) {
      const editCount = resultMetadata.edits_applied?.length || 0;
      return (
        <Alert variant="info" title="Dry Run Mode" description={content}>
          {editCount > 0 && (
            <div className="text-xs opacity-70">
              Would apply {editCount} edit{editCount === 1 ? '' : 's'}
            </div>
          )}
        </Alert>
      );
    }

    // Success message with edit details
    const editCount = resultMetadata?.edits_applied?.length || 0;
    const totalReplacements = resultMetadata?.total_replacements || 0;

    const successDescription =
      editCount > 0
        ? `Applied ${editCount} edit${editCount === 1 ? '' : 's'}${totalReplacements > 0 ? ` with ${totalReplacements} total replacement${totalReplacements === 1 ? '' : 's'}` : ''}`
        : content;

    return (
      <Alert variant="success" title="Edit Successful" description={successDescription}>
        {resultMetadata?.edits_applied && resultMetadata.edits_applied.length <= 3 && (
          <div className="space-y-1">
            {resultMetadata.edits_applied.map((edit, i) => (
              <div key={i} className="text-xs font-mono opacity-60 bg-success/5 rounded p-2">
                <span className="opacity-50">Replace:</span> {edit.old_text.substring(0, 50)}
                {edit.old_text.length > 50 ? '...' : ''}
                <br />
                <span className="opacity-50">With:</span> {edit.new_text.substring(0, 50)}
                {edit.new_text.length > 50 ? '...' : ''}
                {edit.occurrences_replaced > 1 && (
                  <span className="opacity-40"> ({edit.occurrences_replaced} occurrences)</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Alert>
    );
  },

  getIcon: () => {
    return faFileEdit;
  },
};
