'use client';

// ABOUTME: File edit tool renderer with diff visualization
// ABOUTME: Displays file modifications using the FileDiffViewer component for clear before/after comparison

import React from 'react';
import { faFileEdit, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import FileDiffViewer from '@/components/files/FileDiffViewer';
import { createFileDiffFromText, detectLanguageFromPath } from '@/components/files/FileDiffViewer.utils';
import type { ToolRenderer, ToolResult } from './types';
import type { ToolAggregatedEventData } from '@/types/web-events';
import type { FileEditDiffContext } from '@/types/core';

/**
 * File edit-specific tool renderer providing diff visualization
 * for file modification operations
 */
export const fileEditRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        return `Edit ${path}`;
      }
    }
    return 'Edit file';
  },

  isError: (result: ToolResult): boolean => {
    // Trust the tool's own error flag
    return result.isError;
  },

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No output</em>
        </div>
      );
    }

    const content = result.content
      .map(block => block.text || '')
      .join('');

    const isError = fileEditRenderer.isError!(result);

    if (isError) {
      return (
        <div className="bg-error/5 border border-error/20 rounded-lg">
          <div className="px-3 py-2 border-b border-error/20 bg-error/10">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4 text-error flex-shrink-0" />
              <span className="text-error font-medium text-sm">Edit Failed</span>
            </div>
          </div>
          <div className="p-3">
            <div className="text-error/80 text-sm font-mono whitespace-pre-wrap break-words">
              {content}
            </div>
          </div>
        </div>
      );
    }

    // Check if we have the enhanced metadata from the tool
    const resultMetadata = result.metadata as {
      diff?: FileEditDiffContext;
      path?: string;
      oldText?: string;
      newText?: string;
    } | undefined;

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
      
      // Adjust line numbers based on the start line from context
      if (diff.startLine > 1 && fileDiff.chunks[0]) {
        const chunk = fileDiff.chunks[0];
        chunk.oldStart = diff.startLine;
        chunk.newStart = diff.startLine;
        
        // Update line numbers for all lines
        let oldLineNum = diff.startLine;
        let newLineNum = diff.startLine;
        
        chunk.lines.forEach(line => {
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
      
      return (
        <div className="bg-base-100/50">
          <FileDiffViewer
            diff={fileDiff}
            viewMode="unified"
            showLineNumbers={true}
            showFullFile={false}
            maxLines={20}
            className="shadow-sm"
          />
        </div>
      );
    }

    // Fallback: Try to use arguments if no enhanced metadata
    const args = metadata?.arguments as { 
      path?: string; 
      old_text?: string; 
      new_text?: string;
    } | undefined;
    
    const filePath = args?.path;
    const oldText = args?.old_text || '';
    const newText = args?.new_text || '';
    
    // Only show diff if we have both old and new text
    if (filePath && (oldText || newText)) {
      const language = detectLanguageFromPath(filePath);
      const diff = createFileDiffFromText(oldText, newText, filePath, language);
      
      return (
        <div className="bg-base-100/50">
          <div className="text-xs text-base-content/60 px-3 py-1 bg-warning/10 border-b border-warning/20">
            <FontAwesomeIcon icon={faExclamationTriangle} className="w-3 h-3 mr-1" />
            Showing diff without context (upgrade file_edit tool for better diffs)
          </div>
          <FileDiffViewer
            diff={diff}
            viewMode="unified"
            showLineNumbers={true}
            showFullFile={false}
            maxLines={20}
            className="shadow-sm"
          />
        </div>
      );
    }
    
    // Final fallback: Simple success message
    return (
      <div className="bg-success/5 border border-success/20 rounded-lg">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faFileEdit} className="w-4 h-4 text-success flex-shrink-0" />
            <span className="text-success font-medium text-sm">{content}</span>
          </div>
        </div>
      </div>
    );
  },

  getIcon: () => {
    return faFileEdit;
  },
};