'use client';

// ABOUTME: File read tool renderer implementation with syntax-highlighted content display
// ABOUTME: Provides custom display logic for file read operations with content preview and metadata

import React from 'react';
import { faFileCode } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import FileRenderer from '@/components/ui/FileRenderer';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';
import type { ToolAggregatedEventData } from '@/types/web-events';
import { Alert } from '@/components/ui/Alert';

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
    const isError = fileReadRenderer.isError!(result);
    if (isError) {
      const message =
        result.content?.map((block) => block.text || '').join('') || 'An error occurred';
      return <Alert variant="error" title="File Read Failed" description={message} />;
    }

    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No content</em>
        </div>
      );
    }

    const content = result.content.map((block) => block.text || '').join('');

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
