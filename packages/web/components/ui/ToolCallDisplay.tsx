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

// Format tool result for better display
const formatToolResult = (result: string, toolName: string): { formatted: string; type: 'json' | 'bash' | 'file_list' | 'text' } => {
  if (!result || !result.trim()) return { formatted: '', type: 'text' };

  // Try to parse as JSON first (for bash tool results)
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object') {
      // Handle bash tool output format - check for any bash-related properties
      if ('stdout' in parsed || 'stderr' in parsed || 'exitCode' in parsed || toolName.toLowerCase().includes('bash')) {
        const bashResult = parsed as { stdout?: string; stderr?: string; exitCode?: number };
        let formatted = '';
        
        if (bashResult.stdout && bashResult.stdout.trim()) {
          formatted += bashResult.stdout.trim();
        }
        
        if (bashResult.stderr && bashResult.stderr.trim()) {
          if (formatted) formatted += '\n\n';
          formatted += `❌ Error: ${bashResult.stderr.trim()}`;
        }
        
        if (bashResult.exitCode !== undefined && bashResult.exitCode !== 0) {
          if (formatted) formatted += '\n\n';
          formatted += `⚠️ Exit code: ${bashResult.exitCode}`;
        }
        
        return { formatted: formatted || '✅ Command completed with no output', type: 'bash' };
      }
      
      // For other JSON objects, pretty print them
      return { formatted: JSON.stringify(parsed, null, 2), type: 'json' };
    }
  } catch (error) {
    // Not valid JSON, continue with text formatting
    console.debug('Failed to parse as JSON:', error);
  }

  // Handle file listing format (tree-like structure)
  if (result.includes('└') || result.includes('├') || result.includes('/') || toolName.includes('file_list')) {
    return { formatted: result, type: 'file_list' };
  }

  // Handle file paths (for file_find results)
  if (toolName.includes('find') && result.startsWith('/')) {
    const paths = result.split('\n').filter(Boolean);
    if (paths.length > 0) {
      const formatted = paths.map(path => `📁 ${path}`).join('\n');
      return { formatted, type: 'file_list' };
    }
  }

  // Handle "No files found" or similar messages
  if (result.toLowerCase().includes('no files found') || result.toLowerCase().includes('no matches found')) {
    return { formatted: `ℹ️ ${result}`, type: 'text' };
  }

  // Default text formatting
  return { formatted: result, type: 'text' };
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
  const formattedResult = hasResult ? formatToolResult(result, tool) : null;
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
          {hasResult && formattedResult && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-base-content/70 font-medium">
                  {isError ? 'Error Output:' : 'Result:'}
                </div>
                {formattedResult.type === 'bash' && (
                  <div className="text-xs text-base-content/50 bg-slate-100 px-2 py-1 rounded border">
                    bash output
                  </div>
                )}
                {formattedResult.type === 'json' && (
                  <div className="text-xs text-base-content/50 bg-blue-100 px-2 py-1 rounded border">
                    json
                  </div>
                )}
                {formattedResult.type === 'file_list' && (
                  <div className="text-xs text-base-content/50 bg-green-100 px-2 py-1 rounded border">
                    file listing
                  </div>
                )}
              </div>
              <div className={`text-sm rounded border overflow-auto max-h-96 ${
                isError 
                  ? 'bg-error/5 border-error/20 text-error' 
                  : formattedResult.type === 'bash'
                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                    : formattedResult.type === 'json'
                      ? 'bg-blue-50 border-blue-200 text-blue-900'
                      : formattedResult.type === 'file_list'
                        ? 'bg-green-50 border-green-200 text-green-900'
                        : 'bg-base-200 border-base-300 text-base-content/80'
              }`}>
                <pre className="p-3 font-mono text-sm whitespace-pre-wrap break-words">
                  {formattedResult.formatted}
                </pre>
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