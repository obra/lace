// ABOUTME: Renderer for task_view tool executions using TimelineEntry
// ABOUTME: Shows clean, detailed task view with all task information

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '../../ui/TimelineEntry.js';
import { useTimelineItem } from '../contexts/TimelineItemContext.js';
import { limitLines, type ToolRendererProps } from './components/shared.js';

// Status icon mapping
const STATUS_ICONS = {
  pending: '○',
  in_progress: '◐',
  completed: '✓',
  blocked: '⊗',
} as const;

interface TaskNote {
  id: string;
  authorId: string;
  timestamp: string;
  content: string;
}

interface Task {
  id: string;
  title: string;
  status: keyof typeof STATUS_ICONS;
  priority: string;
  assignedTo?: string;
  description?: string;
  prompt: string;
  notes?: TaskNote[];
}

// Parse task from result content
function parseTask(resultText: string): Task | null {
  try {
    return JSON.parse(resultText);
  } catch {
    return null;
  }
}

// Extract task ID from arguments
function extractTaskId(args: Record<string, unknown>): string {
  return typeof args.taskId === 'string' ? args.taskId : 'unknown';
}

// Format timestamp for display
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return timestamp;
  }
}

// Truncate long text for clean display
function truncateText(text: string, maxLength: number = 80): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function TaskViewToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();

  // Extract data from the tool call and result
  const args = item.call.arguments as Record<string, unknown>;
  const taskId = extractTaskId(args);

  const resultText = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;

  const task = item.result && !hasError ? parseTask(resultText) : null;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Build header based on state
  const header = (() => {
    if (isRunning) {
      return (
        <Box>
          <Text bold>task_view: </Text>
          <Text>Loading task {taskId}...</Text>
        </Box>
      );
    }

    if (hasError) {
      return (
        <Box>
          <Text bold>task_view: </Text>
          <Text color="red">{resultText}</Text>
        </Box>
      );
    }

    // Success case
    return (
      <Box>
        <Text bold>task_view: </Text>
        <Text>{taskId}</Text>
      </Box>
    );
  })();

  // Build detailed task content for success case
  const taskContent =
    !isRunning && !hasError && task ? (
      <Box flexDirection="column">
        {/* Title, priority, and status line */}
        <Box>
          <Text>
            {task.title} [{task.priority}]{' '}
          </Text>
          <Text color="gray">
            {STATUS_ICONS[task.status]} {task.status}
          </Text>
        </Box>

        {/* Description if present */}
        {task.description && (
          <Box marginTop={1}>
            <Text>Description: {task.description}</Text>
          </Box>
        )}

        {/* Prompt */}
        <Box marginTop={1}>
          <Text>Prompt: {truncateText(task.prompt)}</Text>
        </Box>

        {/* Notes if present */}
        {task.notes && task.notes.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text>Notes ({task.notes.length}):</Text>
            {task.notes.map((note) => (
              <Box key={note.id} flexDirection="column" marginLeft={2}>
                <Box>
                  <Text color="gray">
                    • [{note.authorId}] {formatTimestamp(note.timestamp)}
                  </Text>
                </Box>
                <Box marginLeft={2}>
                  <Text>{note.content}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    ) : null;

  return (
    <TimelineEntry label={header} summary={taskContent} status={status} isExpandable={false}>
      {taskContent}
    </TimelineEntry>
  );
}
