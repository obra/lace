// ABOUTME: Markdown renderer component with code highlighting and folding functionality
// ABOUTME: Used for rendering system prompts and other markdown content with configurable truncation

'use client';

import { useState } from 'react';
import MessageText from './MessageText';
import ExpandableHeader from './ExpandableHeader';

interface MarkdownRendererProps {
  content: string;
  maxLines?: number;
  isRecentMessage?: boolean;
  className?: string;
}

function countLines(text: string): number {
  return text.split('\n').length;
}

function truncateToLines(text: string, maxLines: number): { truncated: string; isTruncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { truncated: text, isTruncated: false };
  }
  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    isTruncated: true
  };
}

export default function MarkdownRenderer({ 
  content, 
  maxLines = 10, 
  isRecentMessage = true,
  className = '' 
}: MarkdownRendererProps) {
  const [isExpanded, setIsExpanded] = useState(isRecentMessage);
  
  const lineCount = countLines(content);
  const shouldFold = !isRecentMessage && lineCount > maxLines;
  const { truncated, isTruncated } = shouldFold ? truncateToLines(content, maxLines) : { truncated: content, isTruncated: false };
  
  const displayContent = shouldFold && !isExpanded ? truncated : content;

  return (
    <div className={`bg-base-100 border border-base-300 rounded-lg overflow-hidden ${className}`}>
      {shouldFold && (
        <ExpandableHeader
          title={`${lineCount} lines`}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
          badge={isTruncated && !isExpanded ? `+${lineCount - maxLines} more` : undefined}
          className="border-b border-base-300"
        />
      )}
      
      {(!shouldFold || isExpanded) && (
        <div className="p-4">
          <MessageText content={displayContent} />
        </div>
      )}
      
      {shouldFold && !isExpanded && isTruncated && (
        <div className="p-4 pt-0">
          <MessageText content={truncated} />
          <div className="text-center mt-3 pt-3 border-t border-base-300">
            <button
              onClick={() => setIsExpanded(true)}
              className="text-xs text-primary hover:underline"
            >
              Show {lineCount - maxLines} more lines...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}