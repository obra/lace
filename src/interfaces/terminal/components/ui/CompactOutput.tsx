// ABOUTME: Specialized component for tool output truncation with smart line handling
// ABOUTME: Shows first 3 lines by default with expansion controls and syntax highlighting

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { CodeDisplay } from '~/interfaces/terminal/components/ui/CodeDisplay.js';

interface CompactOutputProps {
  output: string;
  language?: string;
  maxLines?: number;
  canExpand?: boolean;
}

function splitIntoLines(text: string): string[] {
  return text.split('\n');
}

function truncateToLines(
  lines: string[],
  maxLines: number
): {
  truncatedLines: string[];
  totalLines: number;
  isTruncated: boolean;
} {
  const totalLines = lines.length;
  const isTruncated = totalLines > maxLines;
  const truncatedLines = isTruncated ? lines.slice(0, maxLines) : lines;

  return {
    truncatedLines,
    totalLines,
    isTruncated,
  };
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;

  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

function getJsonPreview(output: string, maxLines: number): string {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // For objects, show first few keys
      const keys = Object.keys(parsed);
      const previewKeys = keys.slice(0, maxLines - 1); // Leave room for closing brace
      const previewObj: Record<string, unknown> = {};

      for (const key of previewKeys) {
        previewObj[key] = (parsed as Record<string, unknown>)[key];
      }

      // Add indicator if there are more keys
      if (keys.length > previewKeys.length) {
        previewObj[`... +${keys.length - previewKeys.length} more keys`] = '...';
      }

      return JSON.stringify(previewObj, null, 2);
    }
  } catch {
    // Fall back to regular line truncation
  }

  return output;
}

export function CompactOutput({
  output,
  language = 'text',
  maxLines = 3,
  canExpand = true,
}: CompactOutputProps) {
  const [isExpanded, _setIsExpanded] = useState(false);

  if (!output) {
    return <Text color="gray">No output</Text>;
  }

  // Handle JSON specially
  if (language === 'json' && isJsonOutput(output) && !isExpanded) {
    const jsonPreview = getJsonPreview(output, maxLines);
    const lines = splitIntoLines(jsonPreview);
    const { truncatedLines, totalLines, isTruncated } = truncateToLines(lines, maxLines);

    return (
      <Box flexDirection="column">
        <CodeDisplay code={truncatedLines.join('\n')} language="json" compact={false} />
        {isTruncated && canExpand && (
          <Text color="gray">... +{totalLines - maxLines} more lines</Text>
        )}
      </Box>
    );
  }

  // Regular text/code handling
  const displayOutput = isExpanded ? output : output;
  const lines = splitIntoLines(displayOutput);
  const { truncatedLines, totalLines, isTruncated } = truncateToLines(
    lines,
    isExpanded ? lines.length : maxLines
  );

  return (
    <Box flexDirection="column">
      {language === 'text' || language === 'plain' ? (
        // Plain text display
        <Box flexDirection="column">
          {truncatedLines.map((line, index) => (
            <Text key={index} wrap="wrap">
              {line}
            </Text>
          ))}
        </Box>
      ) : (
        // Code display with syntax highlighting
        <CodeDisplay code={truncatedLines.join('\n')} language={language} compact={false} />
      )}

      {/* Truncation indicator */}
      {isTruncated && !isExpanded && canExpand && (
        <Text color="gray">... +{totalLines - maxLines} more lines</Text>
      )}
    </Box>
  );
}
