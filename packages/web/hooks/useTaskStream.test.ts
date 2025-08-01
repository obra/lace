// ABOUTME: Tests for useTaskStream hook with strict event type enforcement
// ABOUTME: Verifies correct eventType filtering and fails fast on architectural mismatches

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskStream } from './useTaskStream';
import type { StreamEvent } from '@/types/stream-events';

// Mock useEventStream
vi.mock('./useEventStream', () => ({
  useEventStream: vi.fn(),
}));

describe('useTaskStream Event Type Enforcement', () => {
  let mockOnEvent: (event: StreamEvent) => void;
  let mockOnTaskCreated: ReturnType<typeof vi.fn>;
  let mockOnTaskUpdated: ReturnType<typeof vi.fn>;
  let mockOnTaskDeleted: ReturnType<typeof vi.fn>;
  let mockOnError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOnTaskCreated = vi.fn();
    mockOnTaskUpdated = vi.fn();
    mockOnTaskDeleted = vi.fn();
    mockOnError = vi.fn();

    // Mock useEventStream to capture the onEvent handler
    const { useEventStream } = require('./useEventStream');
    vi.mocked(useEventStream).mockImplementation((options: any) => {
      mockOnEvent = options.onEvent;
      return { close: vi.fn() };
    });
  });

  describe('correct event type processing', () => {
    it('should process task events with eventType: "task"', () => {
      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
          onTaskUpdated: mockOnTaskUpdated,
          onTaskDeleted: mockOnTaskDeleted,
          onError: mockOnError,
        })
      );

      const validTaskEvent: StreamEvent = {
        id: 'event-1',
        timestamp: new Date(),
        eventType: 'task', // Correct event type
        scope: {
          projectId: 'test-project',
          sessionId: 'test-session',
          taskId: 'task-1',
        },
        data: {
          type: 'task:created',
          task: {
            id: 'task-1',
            title: 'Test Task',
            description: 'Test Description',
            prompt: 'Test Prompt',
            status: 'pending',
            priority: 'medium',
            createdAt: new Date(),
            updatedAt: new Date(),
            notes: [],
            threadId: 'test-session',
            createdBy: 'human',
          },
          context: {
            actor: 'human',
            isHuman: true,
          },
          timestamp: new Date().toISOString(),
        },
      };

      act(() => {
        mockOnEvent(validTaskEvent);
      });

      // Should call the task created handler
      expect(mockOnTaskCreated).toHaveBeenCalledWith({
        type: 'task:created',
        task: expect.objectContaining({
          id: 'task-1',
          title: 'Test Task',
        }),
        context: {
          actor: 'human',
          isHuman: true,
        },
        timestamp: expect.any(String),
      });

      expect(mockOnError).not.toHaveBeenCalled();
    });

    it('should process all task event types correctly', () => {
      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
          onTaskUpdated: mockOnTaskUpdated,
          onTaskDeleted: mockOnTaskDeleted,
        })
      );

      const baseTask = {
        id: 'task-1',
        title: 'Test Task',
        description: '',
        prompt: 'Test Prompt',
        status: 'pending' as const,
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        threadId: 'test-session',
        createdBy: 'human',
      };

      const events = [
        {
          type: 'task:created' as const,
          expectedHandler: mockOnTaskCreated,
          data: { task: baseTask },
        },
        {
          type: 'task:updated' as const,
          expectedHandler: mockOnTaskUpdated,
          data: { task: { ...baseTask, status: 'in_progress' as const } },
        },
        {
          type: 'task:deleted' as const,
          expectedHandler: mockOnTaskDeleted,
          data: { taskId: 'task-1', task: baseTask },
        },
      ];

      events.forEach((eventConfig, index) => {
        const streamEvent: StreamEvent = {
          id: `event-${index}`,
          timestamp: new Date(),
          eventType: 'task',
          scope: {
            projectId: 'test-project',
            sessionId: 'test-session',
            taskId: 'task-1',
          },
          data: {
            type: eventConfig.type,
            ...eventConfig.data,
            context: { actor: 'human' },
            timestamp: new Date().toISOString(),
          },
        };

        act(() => {
          mockOnEvent(streamEvent);
        });

        expect(eventConfig.expectedHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: eventConfig.type,
            context: { actor: 'human' },
            timestamp: expect.any(String),
          })
        );
      });
    });
  });

  describe('strict event type rejection', () => {
    it('should reject events with eventType: "session" - no compatibility fallback', () => {
      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
          onError: mockOnError,
        })
      );

      const wrongEventTypeEvent: StreamEvent = {
        id: 'wrong-event',
        timestamp: new Date(),
        eventType: 'session', // WRONG! Should be 'task'
        scope: {
          projectId: 'test-project',
          sessionId: 'test-session',
        },
        data: {
          type: 'task:created', // Even though the data looks like a task event
          task: {
            id: 'task-1',
            title: 'Test Task',
            description: '',
            prompt: 'Test Prompt',
            status: 'pending',
            priority: 'medium',
            createdAt: new Date(),
            updatedAt: new Date(),
            notes: [],
            threadId: 'test-session',
            createdBy: 'human',
          },
          context: { actor: 'human' },
          timestamp: new Date().toISOString(),
        },
      };

      act(() => {
        mockOnEvent(wrongEventTypeEvent);
      });

      // Should NOT call any task handlers - must fail fast
      expect(mockOnTaskCreated).not.toHaveBeenCalled();
      expect(mockOnTaskUpdated).not.toHaveBeenCalled();
      expect(mockOnTaskDeleted).not.toHaveBeenCalled();
    });

    it('should reject events with other wrong event types', () => {
      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
        })
      );

      const wrongEventTypes = ['system', 'project', 'tool', 'agent'];

      wrongEventTypes.forEach((wrongType) => {
        const wrongEvent: StreamEvent = {
          id: `wrong-${wrongType}`,
          timestamp: new Date(),
          eventType: wrongType as any, // Wrong event type
          scope: { sessionId: 'test-session' },
          data: {
            type: 'task:created',
            task: {
              id: 'task-1',
              title: 'Test',
              description: '',
              prompt: 'Test',
              status: 'pending',
              priority: 'medium',
              createdAt: new Date(),
              updatedAt: new Date(),
              notes: [],
              threadId: 'test-session',
              createdBy: 'human',
            },
            context: { actor: 'human' },
            timestamp: new Date().toISOString(),
          },
        };

        act(() => {
          mockOnEvent(wrongEvent);
        });
      });

      // Should reject ALL wrong event types
      expect(mockOnTaskCreated).not.toHaveBeenCalled();
    });
  });

  describe('invalid task event types within correct eventType', () => {
    it('should reject events with eventType: "task" but invalid task event names', () => {
      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
        })
      );

      const invalidTaskEventNames = [
        'invalid:event',
        'session:started',
        'tool:called',
        'agent:spawned',
        'task:invalid',
      ];

      invalidTaskEventNames.forEach((invalidName) => {
        const invalidEvent: StreamEvent = {
          id: `invalid-${invalidName}`,
          timestamp: new Date(),
          eventType: 'task', // Correct event type
          scope: { sessionId: 'test-session' },
          data: {
            type: invalidName as any, // Invalid task event name
            context: { actor: 'human' },
            timestamp: new Date().toISOString(),
          },
        };

        act(() => {
          mockOnEvent(invalidEvent);
        });
      });

      // Should reject all invalid task event names
      expect(mockOnTaskCreated).not.toHaveBeenCalled();
    });
  });

  describe('subscription configuration', () => {
    it('should subscribe to eventTypes: ["task"] not individual event names', () => {
      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
        })
      );

      const { useEventStream } = require('./useEventStream');
      const subscription = vi.mocked(useEventStream).mock.calls[0][0].subscription;

      expect(subscription).toMatchObject({
        projects: ['test-project'],
        sessions: ['test-session'],
        eventTypes: ['task'], // Should subscribe to 'task' event type, not individual names
      });

      // Should NOT subscribe to individual event names
      expect(subscription.eventTypes).not.toContain('task:created');
      expect(subscription.eventTypes).not.toContain('task:updated');
      expect(subscription.eventTypes).not.toContain('task:deleted');
      expect(subscription.eventTypes).not.toContain('task:note_added');
    });
  });

  describe('architecture enforcement', () => {
    it('should fail fast and make misconfigurations obvious', () => {
      // This test documents the architectural decision to fail fast
      // rather than having compatibility fallbacks that mask bugs

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() =>
        useTaskStream({
          projectId: 'test-project',
          sessionId: 'test-session',
          onTaskCreated: mockOnTaskCreated,
          onError: mockOnError,
        })
      );

      // Send an event that would have been handled by the old compatibility fallback
      const legacyStyleEvent: StreamEvent = {
        id: 'legacy-event',
        timestamp: new Date(),
        eventType: 'session', // This was wrong but used to work
        scope: { sessionId: 'test-session' },
        data: {
          type: 'task:created',
          task: {
            id: 'task-1',
            title: 'Legacy Task',
            description: '',
            prompt: 'Legacy',
            status: 'pending',
            priority: 'medium',
            createdAt: new Date(),
            updatedAt: new Date(),
            notes: [],
            threadId: 'test-session',
            createdBy: 'human',
          },
          context: { actor: 'human' },
          timestamp: new Date().toISOString(),
        },
      };

      act(() => {
        mockOnEvent(legacyStyleEvent);
      });

      // The hook should silently ignore (fail fast) rather than process incorrectly
      expect(mockOnTaskCreated).not.toHaveBeenCalled();

      // This makes architectural problems obvious during development/testing
      // If the backend sends wrong event types, the frontend won't update
      // This forces fixing the root cause rather than masking it

      consoleSpy.mockRestore();
    });
  });
});
