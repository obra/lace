'use client';

// ABOUTME: File read tool renderer implementation with syntax-highlighted content display
// ABOUTME: Provides custom display logic for file read operations with content preview and metadata

import React from 'react';
import { faFileCode } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import FileRenderer from '@/components/ui/FileRenderer';
import type { ToolRenderer, ToolResult } from './types';
import type { ToolAggregatedEventData } from '@/types/web-events';

/**
 * File read-specific tool renderer providing content-centric formatting
 * and display optimized for file reading operations with content preview
 */
export const fileReadRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        // Show full path for summary
        return `Read ${path}`;
      }
    }
    return 'Read file';
  },

  isError: (result: ToolResult): boolean => {
    // Trust the tool's own error flag - it knows if it failed
    return result.status !== 'completed';
  },

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No content</em>
        </div>
      );
    }

    const content = result.content.map((block) => block.text || '').join('');

    const isError = fileReadRenderer.isError!(result);

    if (isError) {
      return (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <FontAwesomeIcon
              icon={faFileCode}
              className="w-4 h-4 text-error mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-error font-medium text-sm mb-1">File Read Failed</div>
              <div className="text-error/80 text-sm whitespace-pre-wrap break-words">{content}</div>
            </div>
          </div>
        </div>
      );
    }

    // Extract file path from arguments
    const filePath =
      typeof metadata?.arguments === 'object' && metadata?.arguments !== null
        ? (metadata.arguments as { path?: string }).path
        : undefined;

    // Extract result metadata
    const resultMetadata = result.metadata as
      | {
          totalLines?: number;
          linesReturned?: number;
          fileSize?: string;
        }
      | undefined;

    // Extract filename for display
    const filename = filePath ? filePath.split('/').pop() || filePath : undefined;

    return (
      <div className="bg-primary/5 border border-primary/20 rounded-lg">
        {/* Content display with syntax highlighting and modal expansion */}
        <div className="p-3">
          <FileRenderer
            content={content}
            filename={filePath}
            fileSize={resultMetadata?.fileSize}
            maxLines={10}
            showLineNumbers={false}
            showCopyButton={true}
          />
        </div>
      </div>
    );
  },

  getIcon: () => {
    return faFileCode;
  },
};
