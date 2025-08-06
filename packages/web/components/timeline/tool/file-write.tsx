'use client';

// ABOUTME: File write tool renderer implementation with elegant file operation display
// ABOUTME: Provides custom display logic for file write operations with path, size, and status

import React from 'react';
import { faFileCode } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { ToolRenderer, ToolResult } from './types';

/**
 * File write-specific tool renderer providing file-centric formatting
 * and operation display optimized for file writing operations
 */
export const fileWriteRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        // Extract filename from path
        const filename = path.split('/').pop() || path;
        return `Write ${filename}`;
      }
    }
    return 'Write file';
  },

  isError: (result: ToolResult): boolean => {
    if (result.isError) return true;
    
    // Check for file system error patterns in content
    const content = result.content?.map(block => block.text || '').join('') || '';
    const errorPatterns = [
      'Failed to write file',
      'Permission denied',
      'Insufficient disk space',
      'EACCES', 'ENOENT', 'ENOSPC', 'EISDIR', 'EMFILE', 'ENFILE'
    ];
    
    return errorPatterns.some(pattern => content.includes(pattern));
  },

  renderResult: (result: ToolResult): React.ReactNode => {
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

    const isError = fileWriteRenderer.isError!(result);

    if (isError) {
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <FontAwesomeIcon icon={faFileCode} className="w-4 h-4 text-error mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-error font-medium text-sm mb-1">File Write Failed</div>
              <div className="text-error/80 text-sm whitespace-pre-wrap break-words">
                {content}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Parse success message for file info
    const sizeMatch = content.match(/(\d+(?:\.\d+)?\s*(?:bytes?|KB|MB|GB))/i);
    const pathMatch = content.match(/to (.+)$/);
    
    const fileSize = sizeMatch ? sizeMatch[1] : null;
    const filePath = pathMatch ? pathMatch[1] : null;
    const fileName = filePath ? filePath.split('/').pop() : null;

    return (
      <div className="bg-success/5 border border-success/20 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <FontAwesomeIcon icon={faFileCode} className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-success font-medium text-sm mb-1">File Written Successfully</div>
            
            {fileName && (
              <div className="text-base-content/80 text-sm font-mono mb-1">
                <span className="font-semibold">{fileName}</span>
                {fileSize && (
                  <span className="text-base-content/60 ml-2">({fileSize})</span>
                )}
              </div>
            )}
            
            {filePath && (
              <div className="text-base-content/60 text-xs font-mono break-all">
                {filePath}
              </div>
            )}
            
            {!fileName && !filePath && (
              <div className="text-success/80 text-sm">
                {content}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },

  getIcon: () => {
    return faFileCode;
  },
};