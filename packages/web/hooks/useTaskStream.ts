// ABOUTME: React hook for subscribing to real-time task updates via SSE
// ABOUTME: Provides event callbacks for task create, update, delete, and note events

import { useEffect, useRef } from 'react';
import type { Task } from '@/types/api';

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
  sessionId: string;
  onTaskCreated?: (event: TaskEvent) => void;
  onTaskUpdated?: (event: TaskEvent) => void;
  onTaskDeleted?: (event: TaskEvent) => void;
  onTaskNoteAdded?: (event: TaskEvent) => void;
  onError?: (error: Error) => void;
}

export function useTaskStream({
  sessionId,
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onTaskNoteAdded,
  onError,
}: UseTaskStreamOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // Create SSE connection
    const eventSource = new EventSource(`/api/tasks/stream?sessionId=${sessionId}`);
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
        console.error('Error parsing task event:', error);
        onError?.(error as Error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('Task stream error:', error);
      onError?.(new Error('Task stream connection failed'));
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, onTaskCreated, onTaskUpdated, onTaskDeleted, onTaskNoteAdded, onError]);

  // Return a function to manually close the stream if needed
  const close = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  return { close };
}
