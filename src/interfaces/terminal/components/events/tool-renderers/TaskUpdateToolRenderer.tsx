// ABOUTME: Renderer for task_update tool executions using TimelineEntry
// ABOUTME: Shows detailed change summary with before/after values

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

// Extract task title from result content
function extractTaskTitle(resultText: string): string | null {
  const match = resultText.match(/Updated task "([^"]+)"/);
  return match ? match[1] : null;
}

// Extract task ID from arguments
function extractTaskId(args: Record<string, unknown>): string {
  return typeof args.taskId === 'string' ? args.taskId : 'unknown';
}

// Detect changes from update arguments
function detectChanges(args: Record<string, unknown>): string[] {
  const changes: string[] = [];

  // Status change (assume from pending if not specified)
  if (typeof args.status === 'string') {
    changes.push(`Status changed: pending → ${args.status}`);
  }

  // Priority change (assume from medium if not specified)
  if (typeof args.priority === 'string') {
    changes.push(`Priority changed: medium → ${args.priority}`);
  }

  // Assignment change
  if (typeof args.assignTo === 'string') {
    changes.push(`Assigned to: ${args.assignTo}`);
  }

  // Description update
  if (typeof args.description === 'string') {
    changes.push('Description updated');
  }

  // Prompt update
  if (typeof args.prompt === 'string') {
    changes.push('Prompt updated');
  }

  return changes;
}

export function TaskUpdateToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();

  // Extract data from the tool call and result
  const args = item.call.arguments;
  const taskId = extractTaskId(args);

  const resultText = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;

  const taskTitle = item.result && !hasError ? extractTaskTitle(resultText) : null;
  const changes = detectChanges(args);

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Build header based on state
  const header = (() => {
    if (isRunning) {
      return (
        <Box>
          <Text bold>task_update: </Text>
          <Text>Updating task {taskId}...</Text>
        </Box>
      );
    }

    if (hasError) {
      return (
        <Box>
          <Text bold>task_update: </Text>
          <Text color="red">{resultText}</Text>
        </Box>
      );
    }

    // Success case
    return (
      <Box>
        <Text bold>task_update: </Text>
        <Text>Updated task "{taskTitle || taskId}"</Text>
      </Box>
    );
  })();

  // Build changes content for success case
  const changesContent =
    !isRunning && !hasError && changes.length > 0 ? (
      <Box flexDirection="column">
        {changes.map((change, index) => (
          <Box key={index}>
            <Text color="gray">• </Text>
            <Text>{change}</Text>
          </Box>
        ))}
      </Box>
    ) : null;

  return (
    <TimelineEntry label={header} summary={changesContent} status={status} isExpandable={false}>
      {changesContent}
    </TimelineEntry>
  );
}
