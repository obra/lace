'use client';

// ABOUTME: File read tool renderer implementation with elegant content display
// ABOUTME: Provides custom display logic for file read operations with content preview and metadata

import React from 'react';
import { faFileCode } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { ToolRenderer, ToolResult } from './types';

const MAX_PREVIEW_LENGTH = 800; // Maximum characters to show in preview
const MAX_PREVIEW_LINES = 20; // Maximum lines to show

/**
 * File read-specific tool renderer providing content-centric formatting
 * and display optimized for file reading operations with content preview
 */
export const fileReadRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        // Extract filename from path
        const filename = path.split('/').pop() || path;
        
        // Add line range info if available
        const argsTyped = args as { startLine?: number; endLine?: number };
        if (argsTyped.startLine && argsTyped.endLine) {
          return `Read ${filename} (lines ${argsTyped.startLine}-${argsTyped.endLine})`;
        } else if (argsTyped.startLine) {
          return `Read ${filename} (from line ${argsTyped.startLine})`;
        } else if (argsTyped.endLine) {
          return `Read ${filename} (to line ${argsTyped.endLine})`;
        }
        
        return `Read ${filename}`;
      }
    }
    return 'Read file';
  },

  isError: (result: ToolResult): boolean => {
    if (result.isError) return true;
    
    // Check for file system error patterns in content
    const content = result.content?.map(block => block.text || '').join('') || '';
    const errorPatterns = [
      'File not found',
      'Permission denied',
      'Line', // catches "Line X exceeds file length"
      'Range too large',
      'EACCES', 'ENOENT', 'EISDIR'
    ];
    
    return errorPatterns.some(pattern => content.includes(pattern));
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No content</em>
        </div>
      );
    }

    const content = result.content
      .map(block => block.text || '')
      .join('');

    const isError = fileReadRenderer.isError!(result);

    if (isError) {
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <FontAwesomeIcon icon={faFileCode} className="w-4 h-4 text-error mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-error font-medium text-sm mb-1">File Read Failed</div>
              <div className="text-error/80 text-sm whitespace-pre-wrap break-words">
                {content}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Extract metadata if available
    const metadata = result.metadata as { 
      totalLines?: number;
      linesReturned?: number; 
      fileSize?: string;
    } | undefined;

    // Determine if content should be truncated for display
    const lines = content.split('\n');
    const shouldTruncate = content.length > MAX_PREVIEW_LENGTH || lines.length > MAX_PREVIEW_LINES;
    
    let displayContent = content;
    let truncatedLines = 0;
    
    if (shouldTruncate) {
      if (content.length > MAX_PREVIEW_LENGTH) {
        displayContent = content.slice(0, MAX_PREVIEW_LENGTH) + '...';
      } else {
        displayContent = lines.slice(0, MAX_PREVIEW_LINES).join('\n');
        truncatedLines = lines.length - MAX_PREVIEW_LINES;
      }
    }

    return (
      <div className="bg-primary/5 border border-primary/20 rounded-lg">
        {/* Header with metadata */}
        <div className="px-3 py-2 border-b border-primary/20 bg-primary/10">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faFileCode} className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0 flex items-center gap-4 text-sm">
              <span className="text-primary font-medium">File Content</span>
              
              {metadata?.fileSize && (
                <span className="text-primary/70">Size: {metadata.fileSize}</span>
              )}
              
              {metadata?.totalLines && (
                <span className="text-primary/70">
                  Lines: {metadata.linesReturned || metadata.totalLines}
                  {metadata.linesReturned && metadata.totalLines !== metadata.linesReturned 
                    ? ` of ${metadata.totalLines}` 
                    : ''
                  }
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content display */}
        <div className="p-3">
          <div className="font-mono text-sm text-base-content/90 whitespace-pre-wrap break-words bg-base-200 border border-base-300 rounded p-3 overflow-x-auto">
            {displayContent}
          </div>
          
          {/* Truncation indicator */}
          {shouldTruncate && (
            <div className="mt-2 text-xs text-base-content/60 flex items-center gap-1">
              <span>Content truncated for display</span>
              {truncatedLines > 0 && (
                <span>({truncatedLines} more lines)</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },

  getIcon: () => {
    return faFileCode;
  },
};