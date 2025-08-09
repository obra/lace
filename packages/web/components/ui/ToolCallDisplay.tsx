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
  faGlobe
} from '@/lib/fontawesome';
import { MessageHeader } from '@/components/ui';
import { getToolRenderer, type ToolResult } from '@/components/timeline/tool';
import type { ToolAggregatedEventData, ToolCallEventData } from '@/types/web-events';

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
const getToolIcon = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (name.includes('file')) return faFile;
  if (name.includes('bash') || name.includes('shell')) return faTerminal;
  if (name.includes('search') || name.includes('grep') || name.includes('find')) return faSearch;
  if (name.includes('edit') || name.includes('write')) return faEdit;
  if (name.includes('list')) return faList;
  if (name.includes('url') || name.includes('fetch')) return faGlobe;
  return faCog;
};

// Add near the top of the file, after imports
function createDefaultToolSummary(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return `Executed ${toolName}`;
  
  const argsObj = args as Record<string, unknown>;
  
  switch (toolName.toLowerCase()) {
    case 'file_list':
      return `Listed files in ${argsObj.path || 'directory'}`;
    
    case 'file_read':
      return `Read file: ${argsObj.file_path || argsObj.path || 'unknown'}`;
    
    case 'file_write':
      return `Wrote file: ${argsObj.file_path || argsObj.path || 'unknown'}`;
    
    case 'bash':
    case 'shell':
      const command = String(argsObj.command || '').substring(0, 50);
      return `Ran command: ${command}${command.length >= 50 ? '...' : ''}`;
    
    case 'search':
    case 'grep':
      return `Searched for: ${argsObj.pattern || argsObj.query || 'pattern'}`;
    
    case 'url_fetch':
      return `Fetched: ${argsObj.url || 'URL'}`;
    
    default:
      // For unknown tools, extract all parameters in a readable format
      const params = Object.entries(argsObj)
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join(', ');
      return params ? `${toolName} (${params})` : `Executed ${toolName}`;
  }
};

function isDefaultError(result: ToolResult): boolean {
  return result?.status === 'failed' || result?.status === 'denied';
}

function createDefaultResultRenderer(result: ToolResult): React.ReactNode {
  const textContent = result.content.map(block => block.text ?? '').join('');
  const isError = result.status === 'failed' || result.status === 'denied';
  
  return (
    <ExpandableResult 
      content={textContent}
      isError={isError}
    />
  );
}

// Expandable result component with 5-line preview
function ExpandableResult({ 
  content, 
  isError 
}: { 
  content: string; 
  isError: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const lines = content.split('\n');
  const shouldShowExpand = lines.length > 5;
  const displayContent = isExpanded ? content : lines.slice(0, 5).join('\n');
  
  return (
    <div className="p-3">
      <div className={`text-sm rounded border ${
        isError 
          ? 'bg-error/5 border-error/20 text-error' 
          : 'bg-base-200 border-base-300 text-base-content/80'
      }`}>
        <pre className="p-3 font-mono text-sm whitespace-pre-wrap break-words">
          {displayContent}
          {shouldShowExpand && !isExpanded && (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-base-content/40 hover:text-base-content/70 cursor-pointer mt-2 block"
            >
              ... ({lines.length - 5} more lines)
            </button>
          )}
          {shouldShowExpand && isExpanded && (
            <button
              onClick={() => setIsExpanded(false)}
              className="text-base-content/40 hover:text-base-content/70 cursor-pointer mt-2 block"
            >
              Show less
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
  const hasResult = result?.content?.some(block => block.text?.trim()) || !!result?.metadata;
  const isError = hasResult && (renderer.isError?.(result!) ?? isDefaultError(result!));
  const isAborted = hasResult && result?.status === 'aborted';
  const args = metadata?.arguments;
  const hasArgs: boolean = Boolean(args && typeof args === 'object' && args !== null && Object.keys(args).length > 0);
  const toolSummary = renderer.getSummary?.(args) ?? createDefaultToolSummary(tool, args);
  // For file_read and file_write, use the summary as the display name since it contains the full path
  const toolDisplayName = (tool === 'file_read' || tool === 'file_write') ? toolSummary : (renderer.getDisplayName?.(tool, result || undefined) ?? tool);
  
  // Create a proper ToolAggregatedEventData object if we need it for renderResult
  const aggregatedData: ToolAggregatedEventData | undefined = metadata ? {
    call: {
      id: metadata.toolId || '',
      name: tool,
      arguments: metadata.arguments
    } as ToolCallEventData,
    result,
    toolName: tool,
    toolId: metadata.toolId,
    arguments: metadata.arguments
  } : undefined;
  
  const resultContent = hasResult ? (renderer.renderResult?.(result!, aggregatedData) ?? createDefaultResultRenderer(result!)) : null;
  
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
        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-sm ${
          isError 
            ? 'bg-error/10 text-error' 
            : isAborted
              ? 'bg-warning/10 text-warning'
            : hasResult 
              ? 'bg-success/10 text-success'
              : 'bg-warning/10 text-warning'
        }`}>
          <FontAwesomeIcon icon={toolIcon} className="text-xs" />
        </div>
      </div>
      
      <div className="flex-1 min-w-0">
        <MessageHeader
          name={toolDisplayName}
          timestamp={timestamp}
          icon={statusIcon}
        />
        
        <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
          {/* Only show the header bar if we have content to display */}
          {(tool !== 'file_read' || hasArgs) && (
            <div className="p-3 bg-base-50 border-b border-base-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {tool.toLowerCase() === 'bash' && args && typeof args === 'object' && 'command' in args ? (
                    <code className="text-sm font-mono bg-base-300 px-2 py-1 rounded text-base-content break-all">
                      $ {String((args as { command: unknown }).command)}
                    </code>
                  ) : (tool !== 'file_read' && tool !== 'file_write') ? (
                    <span className="text-sm text-base-content/80">{String(toolSummary)}</span>
                  ) : null}
                </div>
                
                {hasArgs && (
                  <button
                    onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                    className="text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200 flex-shrink-0"
                  >
                    {showTechnicalDetails ? 'Hide' : 'Show'} Details
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Technical Details (when expanded) */}
          {showTechnicalDetails && hasArgs && (
            <div className="px-3 py-2 bg-base-50 border-b border-base-200">
              <div className="text-xs text-base-content/70 mb-1 font-medium">Technical Details:</div>
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
