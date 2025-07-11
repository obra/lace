// ABOUTME: Renderer for task_list tool executions using TimelineEntry
// ABOUTME: Shows compact task list with status icons and priority information

import React from 'react';
import { Box, Text } from 'ink';
import {
  TimelineEntry,
  TimelineStatus,
} from '~/interfaces/terminal/components/ui/TimelineEntry.js';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';
import { type ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared.js';

// Status icon mapping
const STATUS_ICONS = {
  pending: '○',
  in_progress: '◐',
  completed: '✓',
  blocked: '⊗',
} as const;

interface Task {
  id: string;
  title: string;
  status: keyof typeof STATUS_ICONS;
  priority: string;
  assignedTo?: string;
}

// Parse task list from result content
function parseTaskList(resultText: string): Task[] {
  try {
    return JSON.parse(resultText);
  } catch {
    return [];
  }
}

// Extract filter information from arguments
function extractFilterInfo(args: Record<string, unknown>): string {
  const filter = typeof args.filter === 'string' ? args.filter : 'all';
  return `filter: ${filter}`;
}

// Truncate task title if too long
function truncateTitle(title: string, maxLength: number = 50): string {
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength - 3) + '...';
}

export function TaskListToolRenderer({ item }: ToolRendererProps) {
  useTimelineItem();

  // Extract data from the tool call and result
  const args = item.call.arguments;
  const filterInfo = extractFilterInfo(args);

  const resultText = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;

  const tasks = item.result && !hasError ? parseTaskList(resultText) : [];
  const taskCount = tasks.length;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Build header based on state
  const header = (() => {
    if (isRunning) {
      return (
        <Box>
          <Text bold>task_list: </Text>
          <Text>Fetching tasks...</Text>
        </Box>
      );
    }

    if (hasError) {
      return (
        <Box>
          <Text bold>task_list: </Text>
          <Text color="red">{resultText}</Text>
        </Box>
      );
    }

    // Success case
    const taskWord = taskCount === 1 ? 'task' : 'tasks';
    return (
      <Box>
        <Text bold>task_list: </Text>
        <Text>
          {taskCount} {taskWord} found ({filterInfo})
        </Text>
      </Box>
    );
  })();

  // Build task list content for success case
  const taskListContent =
    !isRunning && !hasError && tasks.length > 0 ? (
      <Box flexDirection="column">
        {tasks.map((task) => {
          const icon = STATUS_ICONS[task.status] || '○';
          const truncatedTitle = truncateTitle(task.title);

          return (
            <Box key={task.id}>
              <Text color="gray">{icon} </Text>
              <Text>
                {task.id} [{task.priority}] {truncatedTitle}
              </Text>
            </Box>
          );
        })}
      </Box>
    ) : null;

  return (
    <TimelineEntry label={header} summary={taskListContent} status={status} isExpandable={false}>
      {taskListContent}
    </TimelineEntry>
  );
}
