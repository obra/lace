// ABOUTME: Default tool output renderer for generic tool results
// ABOUTME: Provides expandable text display with proper formatting

'use client';

import { useState } from 'react';

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  id?: string;
}

interface DefaultToolProps {
  result: ToolResult;
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

export default function DefaultTool({ result }: DefaultToolProps) {
  const textContent = result.content
    .map((block) => block.text ?? '')
    .join('');

  const hasContent = textContent.trim().length > 0;
  const isError = Boolean(result.isError);

  if (!hasContent) {
    return (
      <div className="p-3 text-center text-base-content/50 text-sm">
        (no output)
      </div>
    );
  }

  return (
    <ExpandableResult 
      content={textContent}
      isError={isError}
    />
  );
}