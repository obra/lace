// ABOUTME: Enhanced tool call display component for aggregated tool events
// ABOUTME: Renders tool calls and results in a single, nicely formatted card

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCog,
  faCheck,
  faExclamationTriangle,
  faFile,
  faTerminal,
  faSearch,
  faEdit,
  faList,
  faGlobe,
  faChevronDown,
  faChevronRight,
} from '@/lib/fontawesome';
import { MessageHeader } from '@/components/ui';
import { getToolRenderer, type ToolResult } from '@/components/timeline/tool';
import type { ToolAggregatedEventData } from '@/types/web-events';
import type { ToolCall } from '@/types/core';

interface ToolCallDisplayProps {
  tool: string;
  content: string;
  result?: ToolResult;
  timestamp: Date | string;
  metadata?: {
    toolId?: string;
    arguments?: unknown;
    callData?: unknown;
    resultData?: unknown;
  };
  className?: string;
}

// Tool icon mapping
export const getToolIcon = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (name.includes('file')) return faFile;
  if (name.includes('bash') || name.includes('shell')) return faTerminal;
  if (name.includes('search') || name.includes('grep') || name.includes('find')) return faSearch;
  if (name.includes('edit') || name.includes('write')) return faEdit;
  if (name.includes('list')) return faList;
  if (name.includes('url') || name.includes('fetch')) return faGlobe;
  return faCog;
};

// Generic fallback for tools without specific renderers
export function createDefaultToolSummary(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return `Executed ${toolName}`;

  // For unknown tools, extract all parameters in a readable format
  const argsObj = args as Record<string, unknown>;
  const params = Object.entries(argsObj)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
  return params ? `${toolName} (${params})` : `Executed ${toolName}`;
}

function isDefaultError(result: ToolResult): boolean {
  return result?.status === 'failed' || result?.status === 'denied';
}

function createDefaultResultRenderer(result: ToolResult): React.ReactNode {
  const textContent = result.content.map((block) => block.text ?? '').join('');
  const isError = result.status === 'failed' || result.status === 'denied';

  return <ExpandableResult content={textContent} isError={isError} />;
}

// Expandable result component with 3-line preview for better density
function ExpandableResult({ content, isError }: { content: string; isError: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const lines = content.split('\n');
  const shouldShowExpand = lines.length > 3;
  const displayContent = isExpanded ? content : lines.slice(0, 3).join('\n');

  return (
    <div className="p-2">
      <div
        className={`text-sm rounded border ${
          isError
            ? 'bg-error/5 border-error/20 text-error'
            : 'bg-base-100/80 border-base-300/50 text-base-content/80'
        }`}
      >
        <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words leading-relaxed">
          {displayContent}
          {shouldShowExpand && !isExpanded && (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-base-content/40 hover:text-base-content/70 cursor-pointer mt-2 block text-xs"
            >
              + {lines.length - 3} more lines
            </button>
          )}
          {shouldShowExpand && isExpanded && (
            <button
              onClick={() => setIsExpanded(false)}
              className="text-base-content/40 hover:text-base-content/70 cursor-pointer mt-2 block text-xs"
            >
              − Show less
            </button>
          )}
        </pre>
      </div>
    </div>
  );
}

export function ToolCallDisplay({
  tool,
  content,
  result,
  timestamp,
  metadata,
  className = '',
}: ToolCallDisplayProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Get the custom renderer for this tool type
  const renderer = getToolRenderer(tool);

  const toolIcon = renderer.getIcon?.() ?? getToolIcon(tool);
  const hasResult = result?.content?.some((block) => block.text?.trim()) || !!result?.metadata;
  const isError = hasResult && (renderer.isError?.(result!) ?? isDefaultError(result!));
  const isAborted = hasResult && result?.status === 'aborted';
  const isPending = hasResult && result?.status === 'pending';
  const args = metadata?.arguments;
  const hasArgs: boolean = Boolean(
    args && typeof args === 'object' && args !== null && Object.keys(args).length > 0
  );
  const toolSummary = renderer.getSummary?.(args, result) ?? createDefaultToolSummary(tool, args);
  // Use toolSummary by default, fall back to getDisplayName, then tool name
  const toolDisplayName =
    toolSummary || renderer.getDisplayName?.(tool, result || undefined) || tool;

  // Create a proper ToolAggregatedEventData object if we need it for renderResult
  const aggregatedData: ToolAggregatedEventData | undefined = metadata
    ? {
        call: {
          id: metadata.toolId || '',
          name: tool,
          arguments: metadata.arguments,
        } as ToolCall,
        result,
        toolName: tool,
        toolId: metadata.toolId,
        arguments: metadata.arguments,
      }
    : undefined;

  const resultContent = hasResult
    ? (renderer.renderResult?.(result!, aggregatedData) ?? createDefaultResultRenderer(result!))
    : null;

  // Create success/error icon for header
  const statusIcon = hasResult ? (
    <FontAwesomeIcon
      icon={isError ? faExclamationTriangle : faCheck}
      className={`text-xs ${isError ? 'text-error' : 'text-success'}`}
    />
  ) : null;

  return (
    <div className={`flex gap-3 ${className}`}>
      <div className="flex-shrink-0">
        <div
          className={`w-8 h-8 rounded-md flex items-center justify-center text-sm ${
            isError
              ? 'bg-error/10 text-error'
              : isPending
                ? 'bg-info/10 text-info'
                : isAborted
                  ? 'bg-warning/10 text-warning'
                  : hasResult
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning'
          }`}
        >
          <FontAwesomeIcon icon={toolIcon} className="text-xs" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between mb-1">
          <div className={`flex gap-2 ${tool === 'bash' ? 'items-start' : 'items-center'}`}>
            {statusIcon && (
              <span className={`text-sm ${tool === 'bash' ? 'mt-0.5' : ''}`}>{statusIcon}</span>
            )}
            <span
              className={`font-medium text-sm text-base-content ${
                tool === 'bash' ? 'font-mono whitespace-pre-wrap break-words' : ''
              }`}
            >
              {toolDisplayName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {renderer.getAction?.(result, aggregatedData)}

              {/* Technical details toggle */}
              {hasArgs && (
                <button
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                  className="text-base-content/50 hover:text-base-content p-1 rounded hover:bg-base-200 flex-shrink-0"
                >
                  <FontAwesomeIcon
                    icon={showTechnicalDetails ? faChevronDown : faChevronRight}
                    className="text-xs"
                  />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
          {/* Technical Details (when expanded) */}
          {showTechnicalDetails && hasArgs && (
            <div className="px-3 py-2 bg-base-50 border-b border-base-200">
              <div className="text-xs text-base-content/70 mb-1 font-medium">
                Technical Details:
              </div>
              <div className="text-xs font-mono text-base-content/80 whitespace-pre-wrap bg-base-100 p-2 rounded border">
                <strong>Tool:</strong> {tool}
                {'\n'}
                <strong>Arguments:</strong> {JSON.stringify(args, null, 2)}
                {result && (
                  <>
                    {'\n\n'}
                    <strong>Result:</strong> {JSON.stringify(result, null, 2)}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Tool Result */}
          {resultContent && resultContent}

          {/* No result message - only show if no result content */}
          {!hasResult && (
            <div className="p-3 text-center text-base-content/50 text-sm">
              <FontAwesomeIcon icon={faTerminal} className="mr-2" />
              Tool executed, no output returned
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
