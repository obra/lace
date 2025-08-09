'use client';

// ABOUTME: File write tool renderer implementation with elegant file operation display
// ABOUTME: Provides custom display logic for file write operations with path, size, and status

import React from 'react';
import { faFileEdit, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import FileRenderer from '@/components/ui/FileRenderer';
import type { ToolRenderer, ToolResult } from './types';
import type { ToolAggregatedEventData } from '@/types/web-events';

/**
 * File write-specific tool renderer providing file-centric formatting
 * and operation display optimized for file writing operations
 */
export const fileWriteRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        // Show full path for summary
        return `Write ${path}`;
      }
    }
    return 'Write file';
  },

  isError: (result: ToolResult): boolean => {
    // Trust the tool's own error flag - it knows if it failed
    return result.status !== 'completed';
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

    const isError = fileWriteRenderer.isError!(result);

    if (isError) {
      return (
        <div className="bg-error/5 border border-error/20 rounded-lg">
          <div className="px-3 py-2 border-b border-error/20 bg-error/10">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4 text-error flex-shrink-0" />
              <span className="text-error font-medium text-sm">Write Failed</span>
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

    // Extract file path and content from arguments
    const filePath = typeof metadata?.arguments === 'object' && metadata?.arguments !== null 
      ? (metadata.arguments as { path?: string }).path 
      : undefined;
    
    const fileContent = typeof metadata?.arguments === 'object' && metadata?.arguments !== null 
      ? (metadata.arguments as { content?: string }).content 
      : undefined;
    
    // Extract metadata from result
    const resultMetadata = result.metadata as { 
      bytesWritten?: number;
      fileSize?: string;
    } | undefined;
    
    // Extract size info from the content message or metadata
    const sizeMatch = content.match(/(\d+(?:\.\d+)?)\s*(bytes?|KB|MB|GB)/i);
    const displaySize = resultMetadata?.fileSize || (sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined);
    
    return (
      <div className="bg-success/5 border border-success/20 rounded-lg">
        {/* File content that was written */}
        {fileContent && (
          <div className="p-3">
            <FileRenderer
              content={fileContent}
              filename={filePath}
              fileSize={displaySize}
              maxLines={10}
              showLineNumbers={false}
              showCopyButton={true}
            />
          </div>
        )}
      </div>
    );
  },

  getIcon: () => {
    return faFileEdit;
  },
};