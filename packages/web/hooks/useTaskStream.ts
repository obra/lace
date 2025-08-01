// ABOUTME: Event stream hook for task events
// ABOUTME: Real-time task updates via event stream

import { useCallback, useMemo } from 'react';
import { useEventStream } from './useEventStream';
import type { StreamEvent } from '@/types/stream-events';
import type { Task } from '@/lib/core';

export interface TaskEvent {
  type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:note_added';
  task?: Task;
  taskId?: string; // For delete events
  context: {
    actor: string;
    isHuman?: boolean;
  };
  timestamp: string;
}

interface UseTaskStreamOptions {
  projectId: string;
  sessionId: string;
  onTaskCreated?: (event: TaskEvent) => void;
  onTaskUpdated?: (event: TaskEvent) => void;
  onTaskDeleted?: (event: TaskEvent) => void;
  onTaskNoteAdded?: (event: TaskEvent) => void;
  onError?: (error: Error) => void;
}

function isTaskEvent(streamEvent: StreamEvent): boolean {
  // Task events must have eventType: 'task' - no compatibility fallbacks
  if (streamEvent.eventType !== 'task') {
    return false;
  }

  // Verify the event has valid task event type
  return ['task:created', 'task:updated', 'task:deleted', 'task:note_added'].includes(
    (streamEvent.data as TaskEvent).type
  );
}

export function useTaskStream({
  projectId,
  sessionId,
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onTaskNoteAdded,
  onError,
}: UseTaskStreamOptions) {
  // Handle stream events
  const handleStreamEvent = useCallback(
    (streamEvent: StreamEvent) => {
      // Only process task events
      if (!isTaskEvent(streamEvent)) {
        return;
      }

      const taskEvent = streamEvent.data as TaskEvent;

      // Dispatch to appropriate handler
      switch (taskEvent.type) {
        case 'task:created':
          onTaskCreated?.(taskEvent);
          break;
        case 'task:updated':
          onTaskUpdated?.(taskEvent);
          break;
        case 'task:deleted':
          onTaskDeleted?.(taskEvent);
          break;
        case 'task:note_added':
          onTaskNoteAdded?.(taskEvent);
          break;
      }
    },
    [onTaskCreated, onTaskUpdated, onTaskDeleted, onTaskNoteAdded]
  );

  // Memoize subscription to prevent reconnections
  const subscription = useMemo(
    () => ({
      projects: projectId ? [projectId] : [],
      sessions: sessionId ? [sessionId] : [],
      eventTypes: ['task'], // Subscribe to task event type, not individual task event names
    }),
    [projectId, sessionId]
  );

  // Use event stream with project and session filtering
  const { close } = useEventStream({
    subscription,
    onEvent: handleStreamEvent,
    onError: (error) => {
      onError?.(error);
    },
  });

  return { close };
}
