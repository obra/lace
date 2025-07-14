// ABOUTME: Renderer for file-edit tool executions using TimelineEntry
// ABOUTME: Shows file edit operations with before/after line counts and replacement context

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '../../ui/TimelineEntry.js';
import { useTimelineItem } from '../contexts/TimelineItemContext.js';
import { limitLines, type ToolRendererProps } from './components/shared.js';

export function FileEditToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();

  // Extract data directly
  const { file_path, old_text, new_text } = item.call.arguments as {
    file_path: string;
    old_text: string;
    new_text: string;
  };
  const hasError = item.result?.isError;
  const isRunning = !item.result;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Calculate line counts
  const oldLineCount = old_text ? old_text.split('\n').length : 0;
  const newLineCount = new_text ? new_text.split('\n').length : 0;

  // Build header with file path and line diff counts
  const header = (
    <Box>
      <Text bold>file-edit: </Text>
      <Text>{file_path}</Text>
      <Text color="gray"> - </Text>
      <Text color="red">-{oldLineCount}</Text>
      <Text color="gray"> </Text>
      <Text color="green">+{newLineCount}</Text>
      <Text color="gray"> lines</Text>
    </Box>
  );

  // Build preview content (show old text with diff indicators)
  const preview =
    old_text && item.result && !isRunning
      ? (() => {
          const { lines, truncated } = limitLines(old_text, 2);
          return (
            <Box flexDirection="column">
              {lines.map((line, index) => (
                <Box key={index}>
                  <Text color="red">- </Text>
                  <Text>{line}</Text>
                </Box>
              ))}
              {truncated && <Text color="gray">... and more</Text>}
            </Box>
          );
        })()
      : null;

  // Build expanded content (diff view)
  const expandedContent =
    hasError && item.result ? (
      <Box flexDirection="column">
        <Text color="red">Error:</Text>
        <Box marginLeft={2}>
          <Text color="red">{item.result.content?.[0]?.text || 'Unknown error'}</Text>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        <Text color="red">- Removed:</Text>
        {(() => {
          const { lines } = limitLines(old_text, 20);
          return lines.map((line, index) => (
            <Text key={`old-${index}`} color="red">
              - {line}
            </Text>
          ));
        })()}

        <Box marginTop={1}>
          <Text color="green">+ Added:</Text>
        </Box>
        {(() => {
          const { lines } = limitLines(new_text, 20);
          return lines.map((line, index) => (
            <Text key={`new-${index}`} color="green">
              + {line}
            </Text>
          ));
        })()}
      </Box>
    );

  return (
    <TimelineEntry label={header} summary={preview} status={status} isExpandable={true}>
      {expandedContent}
    </TimelineEntry>
  );
}
