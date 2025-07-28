// ABOUTME: Enhanced tool call display component for aggregated tool events
// ABOUTME: Renders tool calls and results in a single, nicely formatted card

'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faChevronDown, 
  faChevronRight, 
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
import { formatTime } from '@/lib/format';

interface ToolCallDisplayProps {
  tool: string;
  content: string;
  result?: string;
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

// Format tool arguments for display
const formatToolArguments = (args: unknown): string => {
  if (!args) return '';
  
  if (typeof args === 'string') return args;
  
  if (typeof args === 'object' && args !== null) {
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }
  
  return String(args);
};

// Detect if result looks like an error
const isErrorResult = (result: string): boolean => {
  if (!result) return false;
  const lowerResult = result.toLowerCase();
  return lowerResult.includes('error') || 
         lowerResult.includes('failed') || 
         lowerResult.includes('exception') ||
         result.trim().startsWith('Error:');
};

export function ToolCallDisplay({
  tool,
  content,
  result,
  timestamp,
  metadata,
  className = '',
}: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showArguments, setShowArguments] = useState(false);
  
  const toolIcon = getToolIcon(tool);
  const hasResult = result && result.trim().length > 0;
  const isError = hasResult && isErrorResult(result);
  const args = metadata?.arguments;
  const hasArgs = args && typeof args === 'object' && args !== null && Object.keys(args).length > 0;
  
  return (
    <div className={`flex gap-3 ${className}`}>
      <div className="flex-shrink-0">
        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-sm ${
          isError 
            ? 'bg-error/10 text-error' 
            : hasResult 
              ? 'bg-success/10 text-success'
              : 'bg-warning/10 text-warning'
        }`}>
          <FontAwesomeIcon icon={toolIcon} className="text-xs" />
        </div>
      </div>
      
      <div className="flex-1 min-w-0">
        <MessageHeader
          name="Tool Execution"
          timestamp={timestamp}
          badge={{ text: tool, variant: isError ? 'error' : 'info' }}
        />
        
        <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
          {/* Tool Call Header */}
          <div 
            className="flex items-center justify-between p-3 bg-base-50 border-b border-base-200 cursor-pointer hover:bg-base-100"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2">
              <FontAwesomeIcon 
                icon={isExpanded ? faChevronDown : faChevronRight} 
                className="text-xs text-base-content/50" 
              />
              <span className="font-medium text-sm">{tool}</span>
              {hasResult && (
                <div className="flex items-center gap-1">
                  <FontAwesomeIcon 
                    icon={isError ? faExclamationTriangle : faCheck} 
                    className={`text-xs ${isError ? 'text-error' : 'text-success'}`}
                  />
                  <span className={`text-xs ${isError ? 'text-error' : 'text-success'}`}>
                    {isError ? 'Failed' : 'Success'}
                  </span>
                </div>
              )}
            </div>
            
            {hasArgs && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowArguments(!showArguments);
                }}
                className="text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200"
              >
                {showArguments ? 'Hide' : 'Show'} Args
              </button>
            )}
          </div>
          
          {/* Tool Arguments (when expanded) */}
          {showArguments && hasArgs && (
            <div className="px-3 py-2 bg-base-50 border-b border-base-200">
              <div className="text-xs text-base-content/70 mb-1 font-medium">Arguments:</div>
              <pre className="text-xs font-mono text-base-content/80 whitespace-pre-wrap bg-base-100 p-2 rounded border">
                {formatToolArguments(args)}
              </pre>
            </div>
          )}
          
          {/* Tool Result */}
          {hasResult && (
            <div className="p-3">
              <div className="text-xs text-base-content/70 mb-2 font-medium">
                {isError ? 'Error Output:' : 'Result:'}
              </div>
              <div className={`text-sm font-mono rounded border p-3 whitespace-pre-wrap ${
                isError 
                  ? 'bg-error/5 border-error/20 text-error' 
                  : 'bg-base-200 border-base-300 text-base-content/80'
              }`}>
                {result}
              </div>
            </div>
          )}
          
          {/* No result message */}
          {!hasResult && isExpanded && (
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