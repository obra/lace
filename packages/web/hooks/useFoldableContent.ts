// ABOUTME: Custom hook for foldable content with consistent truncation behavior
// ABOUTME: Reusable logic for components that need to fold long content at specified line limits

import { useState, useMemo } from 'react';

interface FoldableContentResult {
  displayContent: string;
  isExpanded: boolean;
  shouldFold: boolean;
  isTruncated: boolean;
  toggleExpanded: () => void;
  remainingLines: number;
}

function truncateText(text: string, maxLines: number): { truncated: string; isTruncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { truncated: text, isTruncated: false };
  }
  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    isTruncated: true,
  };
}

export function useFoldableContent(
  content: string,
  maxLines: number,
  isRecentMessage: boolean = true
): FoldableContentResult {
  const [isExpanded, setIsExpanded] = useState(isRecentMessage);

  // Memoize truncation calculation for performance
  const { truncated, isTruncated } = useMemo(
    () => truncateText(content, maxLines),
    [content, maxLines]
  );

  const shouldFold = !isRecentMessage && isTruncated;
  const displayContent = shouldFold && !isExpanded ? truncated : content;
  const totalLines = content.split('\n').length;
  const remainingLines = totalLines - maxLines;

  const toggleExpanded = () => setIsExpanded(!isExpanded);

  return {
    displayContent,
    isExpanded,
    shouldFold,
    isTruncated,
    toggleExpanded,
    remainingLines,
  };
}
