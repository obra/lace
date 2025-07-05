// ABOUTME: Renderer for file-write tool executions using TimelineEntry
// ABOUTME: Shows file write operations with character counts and content preview

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '../../ui/TimelineEntry.js';
import { useTimelineItem } from '../contexts/TimelineItemContext.js';
import { limitLines, type ToolRendererProps } from './components/shared.js';
import { logger } from '../../../../../utils/logger.js';

export function FileWriteToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();
  
  // Extract and validate data
  const args = item.call.arguments as Record<string, unknown>;
  
  if (typeof args.file_path !== 'string') {
    logger.warn('FileWriteToolRenderer: Invalid file_path argument', { 
      file_path: args.file_path, 
      callId: item.call.id 
    });
    return null;
  }
  
  if (typeof args.content !== 'string') {
    logger.warn('FileWriteToolRenderer: Invalid content argument', { 
      content: typeof args.content, 
      callId: item.call.id 
    });
    return null;
  }
  
  const file_path = args.file_path;
  const content = args.content;
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Calculate character count and line count
  const charCount = content ? content.length : 0;
  const lineCount = content ? content.split('\n').length : 0;
  
  // Build header with file path and character count
  const header = (
    <Box>
      <Text bold>file-write: </Text>
      <Text>{file_path}</Text>
      <Text color="gray"> - </Text>
      <Text color="cyan">{charCount} chars</Text>
      {lineCount > 1 && (
        <React.Fragment>
          <Text color="gray">, </Text>
          <Text color="gray">{lineCount} lines</Text>
        </React.Fragment>
      )}
    </Box>
  );
  
  // Build preview content (only show when complete and has content)
  const preview = content && item.result && !isRunning ? (() => {
    const { lines, truncated } = limitLines(content, 2);
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
        {truncated && <Text color="gray">... and more</Text>}
      </Box>
    );
  })() : null;
  
  // Build expanded content
  const expandedContent = content ? (
    <Box flexDirection="column">
      {(() => {
        const { lines, truncated, remaining } = limitLines(content, 50);
        return (
          <React.Fragment>
            {lines.map((line, index) => (
              <Text key={index}>{line}</Text>
            ))}
            {truncated && (
              <Text color="gray">... ({remaining} more lines)</Text>
            )}
          </React.Fragment>
        );
      })()}
    </Box>
  ) : (
    <Text color="gray">(empty file)</Text>
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