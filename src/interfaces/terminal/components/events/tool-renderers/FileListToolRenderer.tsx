// ABOUTME: Renderer for file-list tool executions using TimelineEntry
// ABOUTME: Shows directory trees with proper indentation, file sizes, and type indicators

import React from 'react';
import { Box, Text } from 'ink';
import {
  TimelineEntry,
  TimelineStatus,
} from '~/interfaces/terminal/components/ui/TimelineEntry.js';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';
import {
  limitLines,
  type ToolRendererProps,
} from '~/interfaces/terminal/components/events/tool-renderers/components/shared.js';

// Helper function to count tree elements
function countTreeElements(text: string): { files: number; dirs: number } {
  const lines = text.split('\n');
  let files = 0;
  let dirs = 0;

  for (const line of lines) {
    if (line.includes('(') && line.includes('bytes)')) {
      files++;
    } else if (line.includes('/') && !line.includes('bytes)')) {
      dirs++;
    }
  }

  return { files, dirs };
}

export function FileListToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();

  // Extract data directly
  const { path, recursive } = item.call.arguments as { path: string; recursive?: boolean };
  const output = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Calculate stats
  const isEmpty = output === 'No files found';
  const counts = isEmpty || !output ? { files: 0, dirs: 0 } : countTreeElements(output);

  // Build header with path and file/directory counts
  const header = (
    <Box>
      <Text bold>file-list: </Text>
      <Text>{path || 'current directory'}</Text>
      {recursive && <Text color="gray"> (recursive)</Text>}
      {item.result && !hasError && !isEmpty && (
        <React.Fragment>
          <Text color="gray"> - </Text>
          <Text color="cyan">
            {counts.files} files, {counts.dirs} dirs
          </Text>
        </React.Fragment>
      )}
    </Box>
  );

  // Build preview content
  const preview =
    output && item.result && !isRunning
      ? (() => {
          if (isEmpty) {
            return <Text color="gray">No files found</Text>;
          }
          const { lines, truncated, remaining } = limitLines(output, 3);
          return (
            <Box flexDirection="column">
              {lines.map((line, index) => (
                <Text key={index} color="gray">
                  {line}
                </Text>
              ))}
              {truncated && <Text color="gray">... and {remaining} more lines</Text>}
            </Box>
          );
        })()
      : null;

  // Build expanded content
  const expandedContent =
    hasError && item.result ? (
      <Box flexDirection="column">
        <Text color="red">Error:</Text>
        <Box marginLeft={2}>
          <Text color="red">{item.result.content?.[0]?.text || 'Unknown error'}</Text>
        </Box>
      </Box>
    ) : isEmpty ? (
      <Text color="gray">No files found</Text>
    ) : (
      <Text>{output}</Text>
    );

  return (
    <TimelineEntry label={header} summary={preview} status={status} isExpandable={true}>
      {expandedContent}
    </TimelineEntry>
  );
}
