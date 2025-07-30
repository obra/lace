// ABOUTME: Bash tool output renderer with terminal-style display
// ABOUTME: Handles stdout/stderr with proper formatting, colors, and expandable sections

'use client';

import { useState } from 'react';

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  id?: string;
}

interface BashToolProps {
  result: ToolResult;
}

// Terminal-style expandable output component
function TerminalOutput({ 
  content, 
  isError,
  label 
}: { 
  content: string; 
  isError?: boolean;
  label?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!content.trim()) return null;
  
  const lines = content.split('\n');
  const shouldShowExpand = lines.length > 8;
  const displayContent = isExpanded ? content : lines.slice(0, 8).join('\n');
  
  return (
    <div className="mb-3 last:mb-0">
      {label && (
        <div className={`text-xs font-medium mb-1 ${
          isError ? 'text-red-600' : 'text-gray-600'
        }`}>
          {label}
        </div>
      )}
      <div className={`rounded border font-mono text-sm ${
        isError 
          ? 'bg-red-50 border-red-200 text-red-800' 
          : 'bg-gray-50 border-gray-200 text-gray-800'
      }`}>
        <pre className="p-3 whitespace-pre-wrap break-words overflow-x-auto">
          {displayContent}
          {shouldShowExpand && !isExpanded && (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-gray-500 hover:text-gray-700 cursor-pointer mt-2 block text-xs"
            >
              ... ({lines.length - 8} more lines)
            </button>
          )}
          {shouldShowExpand && isExpanded && (
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-500 hover:text-gray-700 cursor-pointer mt-2 block text-xs"
            >
              Show less
            </button>
          )}
        </pre>
      </div>
    </div>
  );
}

export default function BashTool({ result }: BashToolProps) {
  const textContent = result.content
    .map((block) => block.text ?? '')
    .join('');

  try {
    const bashResult = JSON.parse(textContent) as { 
      stdout?: string; 
      stderr?: string; 
      exitCode?: number; 
    };

    const hasStdout = bashResult.stdout?.trim();
    const hasStderr = bashResult.stderr?.trim();
    const hasError = bashResult.exitCode !== 0 || hasStderr;

    if (!hasStdout && !hasStderr) {
      return (
        <div className="p-3 text-center text-gray-500 text-sm bg-gray-50 rounded border">
          ✅ Command completed with no output
        </div>
      );
    }

    return (
      <div className="p-3">
        {hasStdout && (
          <TerminalOutput content={bashResult.stdout!} />
        )}
        {hasStderr && (
          <TerminalOutput 
            content={bashResult.stderr!} 
            isError={true}
            label="stderr"
          />
        )}
        {bashResult.exitCode !== undefined && bashResult.exitCode !== 0 && (
          <div className="text-xs text-red-600 mt-2">
            ⚠️ Exit code: {bashResult.exitCode}
          </div>
        )}
      </div>
    );
  } catch {
    // Fallback for malformed JSON
    return (
      <div className="p-3">
        <div className="bg-gray-50 border border-gray-200 rounded">
          <pre className="p-3 font-mono text-sm whitespace-pre-wrap break-words">
            {textContent || '(no output)'}
          </pre>
        </div>
      </div>
    );
  }
}