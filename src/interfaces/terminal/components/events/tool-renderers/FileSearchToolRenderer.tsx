// ABOUTME: Renderer for ripgrep-search tool executions using TimelineEntry
// ABOUTME: Shows search results grouped by file with line numbers and highlighted matches

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '../../ui/TimelineEntry.js';
import { useTimelineItem } from '../contexts/TimelineItemContext.js';
import { limitLines, type ToolRendererProps } from './components/shared.js';

// Extract match count from search results
function extractMatchCount(output: string): string | null {
  const matchLine = output.split('\n')[0];
  const matchRegex = /Found (\d+) match(?:es)? in (\d+) files?:/;
  const match = matchLine.match(matchRegex);
  
  if (match) {
    const [, matches, files] = match;
    const matchText = matches === '1' ? 'match' : 'matches';
    const fileText = files === '1' ? 'file' : 'files';
    return `${matches} ${matchText} in ${files} ${fileText}`;
  }
  return null;
}

export function FileSearchToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();
  
  // Extract data directly
  const { pattern, path } = item.call.arguments as { pattern: string; path: string };
  const output = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Check for empty results
  const isEmpty = output === 'No matches found';
  
  // Extract match stats
  const matchStats = !isEmpty && output ? extractMatchCount(output) : null;
  
  // Build header with pattern, path, and match counts
  const header = (
    <Box>
      <Text bold>ripgrep-search: </Text>
      <Text>"{pattern}"</Text>
      <Text color="gray"> in {path}</Text>
      {matchStats && (
        <React.Fragment>
          <Text color="gray"> - </Text>
          <Text color="cyan">{matchStats}</Text>
        </React.Fragment>
      )}
    </Box>
  );
  
  // Build preview content
  const preview = output && item.result && !isRunning ? (() => {
    if (isEmpty) {
      return <Text color="gray">No matches found</Text>;
    }
    const { lines, truncated } = limitLines(output, 4);
    // Skip the "Found X matches" header line
    const previewLines = lines.filter(line => !line.startsWith('Found'));
    const displayLines = previewLines.slice(0, 3);
    
    return (
      <Box flexDirection="column">
        {displayLines.map((line, index) => (
          <Text key={index} color="gray">
            {line}
          </Text>
        ))}
        {(truncated || previewLines.length > 3) && (
          <Text color="gray">... and more</Text>
        )}
      </Box>
    );
  })() : null;
  
  // Build expanded content
  const expandedContent = hasError && item.result ? (
    <Box flexDirection="column">
      <Text color="red">Error:</Text>
      <Box marginLeft={2}>
        <Text color="red">{item.result.content?.[0]?.text || 'Unknown error'}</Text>
      </Box>
    </Box>
  ) : isEmpty ? (
    <Text color="gray">No matches found</Text>
  ) : (
    <Text>{output}</Text>
  );

  return (
    <TimelineEntry
      label={header}
      summary={preview}
      status={status}
      isExpandable={true}
    >
      {expandedContent}
    </TimelineEntry>
  );
}