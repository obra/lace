// ABOUTME: Renderer for task_add tool executions using TimelineEntry
// ABOUTME: Shows task creation confirmation with detailed success display

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

// Extract task ID from result content
function extractTaskId(resultText: string): string | null {
  const match = resultText.match(/task_\d+_[a-z0-9]+/);
  return match ? match[0] : null;
}

// Extract task title from arguments
function extractTaskTitle(args: Record<string, unknown>): string {
  return typeof args.title === 'string' ? args.title : 'Unknown task';
}

export function TaskAddToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();

  // Extract data from the tool call and result
  const args = item.call.arguments;
  const taskTitle = extractTaskTitle(args);
  const prompt = typeof args.prompt === 'string' ? args.prompt : '';
  const priority = typeof args.priority === 'string' ? args.priority : 'medium';
  const assignedTo = typeof args.assignedTo === 'string' ? args.assignedTo : null;

  const resultText = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  const taskId = item.result ? extractTaskId(resultText) : null;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Build header based on state
  const header = (() => {
    if (isRunning) {
      return (
        <Box>
          <Text bold>task_add: </Text>
          <Text>Creating task "{taskTitle}"</Text>
        </Box>
      );
    }

    if (hasError) {
      return (
        <Box>
          <Text bold>task_add: </Text>
          <Text color="red">{resultText}</Text>
        </Box>
      );
    }

    // Success case
    return (
      <Box>
        <Text bold>task_add: </Text>
        <Text>Created task "{taskTitle}"</Text>
      </Box>
    );
  })();

  // Build detailed content for success case
  const detailsContent =
    !isRunning && !hasError && taskId ? (
      <Box flexDirection="column">
        <Box>
          <Text color="gray">→ </Text>
          <Text>
            {taskId} [{priority} priority]
          </Text>
        </Box>
        {assignedTo && (
          <Box>
            <Text color="gray">→ assigned to: </Text>
            <Text>{assignedTo}</Text>
          </Box>
        )}
        <Box>
          <Text color="gray">→ prompt: </Text>
          <Text>{limitLines(prompt, 1).lines[0]}...</Text>
        </Box>
      </Box>
    ) : null;

  return (
    <TimelineEntry label={header} summary={detailsContent} status={status} isExpandable={false}>
      {detailsContent}
    </TimelineEntry>
  );
}
