// ABOUTME: Renderer for task_add_note tool executions using TimelineEntry
// ABOUTME: Shows note addition confirmation with note preview

import React from 'react';
import { Box, Text } from 'ink';
import {
  TimelineEntry,
  TimelineStatus,
} from '~/interfaces/terminal/components/ui/TimelineEntry.js';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';
import { type ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared.js';

// Extract task ID from result content
function extractTaskId(resultText: string): string | null {
  const match = resultText.match(/task_\d+_[a-z0-9]+/);
  return match ? match[0] : null;
}

// Extract task ID from arguments
function extractTaskIdFromArgs(args: Record<string, unknown>): string {
  return typeof args.taskId === 'string' ? args.taskId : 'unknown';
}

// Extract note content from arguments
function extractNoteContent(args: Record<string, unknown>): string {
  return typeof args.note === 'string' ? args.note : '';
}

// Truncate note content for preview
function truncateNote(note: string, maxLength: number = 100): string {
  if (note.length <= maxLength) return note;
  return note.substring(0, maxLength - 3) + '...';
}

// Escape special characters for display
function escapeNote(note: string): string {
  return note.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}

export function TaskAddNoteToolRenderer({ item }: ToolRendererProps) {
  useTimelineItem();

  // Extract data from the tool call and result
  const args = item.call.arguments;
  const taskIdFromArgs = extractTaskIdFromArgs(args);
  const noteContent = extractNoteContent(args);

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
          <Text bold>task_add_note: </Text>
          <Text>Adding note to {taskIdFromArgs}...</Text>
        </Box>
      );
    }

    if (hasError) {
      return (
        <Box>
          <Text bold>task_add_note: </Text>
          <Text color="red">{resultText}</Text>
        </Box>
      );
    }

    // Success case
    return (
      <Box>
        <Text bold>task_add_note: </Text>
        <Text>Added note to {taskId}</Text>
      </Box>
    );
  })();

  // Build note preview content for success case
  const notePreviewContent =
    !isRunning && !hasError && noteContent ? (
      <Box>
        <Text color="cyan">💬 </Text>
        <Text>"{escapeNote(truncateNote(noteContent))}"</Text>
      </Box>
    ) : null;

  return (
    <TimelineEntry label={header} summary={notePreviewContent} status={status} isExpandable={false}>
      {notePreviewContent}
    </TimelineEntry>
  );
}
