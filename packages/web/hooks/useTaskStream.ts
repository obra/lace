// ABOUTME: React hook for subscribing to real-time task updates via SSE
// ABOUTME: Provides event callbacks for task create, update, delete, and note events

import { useEffect, useRef } from 'react';
import type { Task } from '@/types';

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

export function useTaskStream({
  projectId,
  sessionId,
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onTaskNoteAdded,
  onError,
}: UseTaskStreamOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!projectId || !sessionId) return;

    // Create SSE connection
    const eventSource = new EventSource(
      `/api/projects/${projectId}/sessions/${sessionId}/tasks/stream`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as
          | TaskEvent
          | { type: 'connected'; sessionId: string };

        if (data.type === 'connected') {
          // Connected to task stream
          return;
        }

        // Handle task events
        const taskEvent = data;
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
      } catch (error) {
        onError?.(error as Error);
      }
    };

    eventSource.onerror = (_error) => {
      onError?.(new Error('Task stream connection failed'));
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [projectId, sessionId, onTaskCreated, onTaskUpdated, onTaskDeleted, onTaskNoteAdded, onError]);

  // Return a function to manually close the stream if needed
  const close = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  return { close };
}
