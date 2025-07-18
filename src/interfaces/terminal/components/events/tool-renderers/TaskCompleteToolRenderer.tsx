// ABOUTME: Renderer for task_complete tool executions using TimelineEntry
// ABOUTME: Shows simple success confirmation for task completion

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '~/interfaces/terminal/components/ui/TimelineEntry';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';
import { type ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared';

// Extract task ID from result content
function extractTaskId(resultText: string): string | null {
  const match = resultText.match(/task_\d+_[a-z0-9]+/);
  return match ? match[0] : null;
}

// Extract task ID from arguments
function extractTaskIdFromArgs(args: Record<string, unknown>): string {
  return typeof args.id === 'string' ? args.id : 'unknown';
}

export function TaskCompleteToolRenderer({ item }: ToolRendererProps) {
  useTimelineItem();

  // Extract data from the tool call and result
  const args = item.call.arguments;
  const taskIdFromArgs = extractTaskIdFromArgs(args);

  const resultText = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;

  const taskId =
    item.result && !hasError ? extractTaskId(resultText) || taskIdFromArgs : taskIdFromArgs;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Build header based on state
  const header = (() => {
    if (isRunning) {
      return (
        <Box>
          <Text bold>task_complete: </Text>
          <Text>Completing task {taskIdFromArgs}...</Text>
        </Box>
      );
    }

    if (hasError) {
      return (
        <Box>
          <Text bold>task_complete: </Text>
          <Text color="red">{resultText}</Text>
        </Box>
      );
    }

    // Success case
    return (
      <Box>
        <Text bold>task_complete: </Text>
        <Text>{taskId} completed</Text>
      </Box>
    );
  })();

  return (
    <TimelineEntry label={header} summary={null} status={status} isExpandable={false}>
      {null}
    </TimelineEntry>
  );
}
