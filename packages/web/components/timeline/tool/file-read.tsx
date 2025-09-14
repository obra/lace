'use client';

// ABOUTME: File read tool renderer implementation with syntax-highlighted content display
// ABOUTME: Provides custom display logic for file read operations with content preview and metadata

import React from 'react';
import { faFileCode } from '@fortawesome/free-solid-svg-icons';
import FileRenderer from '@/components/ui/FileRenderer';
import FileModalButton from '@/components/ui/FileModalButton';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';
import type { ToolAggregatedEventData } from '@/types/web-events';
import { Alert } from '@/components/ui/Alert';

/**
 * File read-specific tool renderer providing content-centric formatting
 * and display optimized for file reading operations with content preview
 */
export const fileReadRenderer: ToolRenderer = {
  getSummary: (args: unknown, result?: ToolResult): string => {
    let baseName = 'Read file';

    if (typeof args === 'object' && args !== null && 'path' in args) {
      const path = (args as { path?: unknown }).path;
      if (typeof path === 'string' && path.trim()) {
        baseName = `Read ${path}`;
      }
    }

    // Check if this is a line range read operation
    const argsObj = args as Record<string, unknown> | null;
    const startLine = argsObj?.startLine;
    const endLine = argsObj?.endLine;

    if (typeof startLine === 'number' && typeof endLine === 'number') {
      return `${baseName} (lines ${startLine}-${endLine})`;
    }

    // Add file metadata if available and not a line range operation
    if (result?.metadata) {
      const metadata = result.metadata as
        | {
            totalLines?: number;
            fileSize?: string;
          }
        | undefined;

      if (metadata) {
        const parts = [];
        if (metadata.totalLines) parts.push(`${metadata.totalLines} lines`);
        if (metadata.fileSize) parts.push(metadata.fileSize);

        if (parts.length > 0) {
          return `${baseName} (${parts.join(' • ')})`;
        }
      }
    }

    return baseName;
  },

  isError: (result: ToolResult): boolean => {
    // Trust the tool's own error flag - it knows if it failed
    return result.status !== 'completed';
  },

  getAction: (result?: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    if (!result?.content || result.content.length === 0) {
      return null;
    }

    const content = result.content.map((block) => block.text || '').join('');
    const lines = content.split('\n');
    const needsExpansion = lines.length > 10; // Match FileRenderer's logic

    if (!needsExpansion) {
      return null;
    }

    // Extract file path and line info from arguments
    const args = metadata?.arguments as { path?: string; startLine?: number } | undefined;
    const filePath = args?.path;
    const startLine = args?.startLine;

    return (
      <FileModalButton
        content={content}
        filePath={filePath}
        result={result}
        startLineNumber={startLine || 1}
      />
    );
  },

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData): React.ReactNode => {
    const isError = fileReadRenderer.isError!(result);
    if (isError) {
      const message =
        result.content?.map((block) => block.text || '').join('') || 'An error occurred';
      return <Alert variant="error" title="File Read Failed" description={message} style="soft" />;
    }

    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No content</em>
        </div>
      );
    }

    const content = result.content.map((block) => block.text || '').join('');

    // Extract file path and line range from arguments
    const args = metadata?.arguments as
      | { path?: string; startLine?: number; endLine?: number }
      | undefined;
    const filePath = args?.path;
    const startLine = args?.startLine;

    // Extract result metadata
    const resultMetadata = result.metadata as
      | {
          totalLines?: number;
          linesReturned?: number;
          fileSize?: string;
        }
      | undefined;

    return (
      <FileRenderer
        content={content}
        filename={filePath}
        fileSize={resultMetadata?.fileSize}
        maxLines={10}
        showLineNumbers={true}
        startLineNumber={startLine || 1}
        showCopyButton={true}
        hideFooter={true}
      />
    );
  },

  getIcon: () => {
    return faFileCode;
  },
};
