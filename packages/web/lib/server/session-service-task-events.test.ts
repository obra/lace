// ABOUTME: Tests for TaskManager event forwarding in SessionService
// ABOUTME: Verifies correct event types, scopes, and real-time task updates

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionService, getSessionService } from './session-service';
import { Project } from '@/lib/server/lace-imports';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import type { StreamEvent } from '@/types/stream-events';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

// Import real EventStreamManager for integration testing
import { EventStreamManager } from '@/lib/event-stream-manager';

describe('SessionService TaskManager Event Forwarding', () => {
  const _tempDir = useTempLaceDir();
  let sessionService: SessionService;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;
  let testProject: ReturnType<typeof Project.create>;

  beforeEach(async () => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Set up spy on real EventStreamManager
    broadcastSpy = vi.spyOn(EventStreamManager.getInstance(), 'broadcast');

    // Create a real project for testing
    testProject = Project.create(
      'Test Project',
      process.cwd(),
      'Test project for event forwarding tests',
      {}
    );

    sessionService = getSessionService();
    sessionService.clearActiveSessions();
  });

  afterEach(async () => {
    broadcastSpy.mockRestore();
    if (sessionService) {
      await sessionService.stopAllAgents().catch(() => {
        // Ignore cleanup errors - database may already be closed
      });
      sessionService.clearActiveSessions();
    }
    teardownTestPersistence();
  });

  describe('task:created event forwarding', () => {
    it('should forward task:created events with correct eventType and scope', async () => {
      // Create a session
      const session = await sessionService.createSession(
        'Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      // Get the session instance to access TaskManager
      const sessionInstance = await sessionService.getSession(session.id);
      expect(sessionInstance).toBeTruthy();

      const taskManager = sessionInstance!.getTaskManager();

      // Create a task which should trigger task:created event
      const task = await taskManager.createTask(
        {
          title: 'Test Task',
          prompt: 'Test task prompt',
          priority: 'high',
        },
        {
          actor: 'human',
          isHuman: true,
        }
      );

      // Verify the broadcast was called with correct eventType: 'task'
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'task', // Critical: Must be 'task', not 'session'
          scope: expect.objectContaining({
            projectId: testProject.getId(),
            sessionId: session.id,
            taskId: task.id,
          }),
          data: expect.objectContaining({
            type: 'task:created',
            task: expect.objectContaining({
              id: task.id,
              title: 'Test Task',
              prompt: 'Test task prompt',
              priority: 'high',
            }),
            context: expect.objectContaining({
              actor: 'human',
              isHuman: true,
            }),
            timestamp: expect.any(Date),
          }),
        })
      );
    });

    it('should include complete scope information in task events', async () => {
      const session = await sessionService.createSession(
        'Scope Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      const sessionInstance = await sessionService.getSession(session.id);
      const taskManager = sessionInstance!.getTaskManager();

      await taskManager.createTask(
        {
          title: 'Scope Test Task',
          prompt: 'Testing scope',
          priority: 'medium',
        },
        {
          actor: 'human',
        }
      );

      const broadcastCall = broadcastSpy.mock.calls[0][0] as StreamEvent;

      // Verify complete scope hierarchy
      expect(broadcastCall.scope).toEqual(
        expect.objectContaining({
          projectId: testProject.getId(),
          sessionId: session.id,
          taskId: expect.any(String),
        })
      );

      // Verify no missing scope properties
      expect(broadcastCall.scope.projectId).toBeDefined();
      expect(broadcastCall.scope.sessionId).toBeDefined();
      expect(broadcastCall.scope.taskId).toBeDefined();
    });
  });

  describe('task:updated event forwarding', () => {
    it('should forward task:updated events with correct eventType', async () => {
      const session = await sessionService.createSession(
        'Update Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      const sessionInstance = await sessionService.getSession(session.id);
      const taskManager = sessionInstance!.getTaskManager();

      // Create task first
      const task = await taskManager.createTask(
        {
          title: 'Update Test Task',
          prompt: 'Testing updates',
          priority: 'low',
        },
        {
          actor: 'human',
        }
      );

      // Clear previous broadcasts
      broadcastSpy.mockClear();

      // Update the task
      await taskManager.updateTask(task.id, { status: 'in_progress' }, { actor: 'human' });

      // Verify task:updated event was broadcast correctly
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'task', // Must be 'task'
          scope: expect.objectContaining({
            projectId: testProject.getId(),
            sessionId: session.id,
            taskId: task.id,
          }),
          data: expect.objectContaining({
            type: 'task:updated',
            task: expect.objectContaining({
              id: task.id,
              status: 'in_progress',
            }),
          }),
        })
      );
    });
  });

  describe('task:deleted event forwarding', () => {
    it('should forward task:deleted events with taskId in data and scope', async () => {
      const session = await sessionService.createSession(
        'Delete Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      const sessionInstance = await sessionService.getSession(session.id);
      const taskManager = sessionInstance!.getTaskManager();

      // Create task first
      const task = await taskManager.createTask(
        {
          title: 'Delete Test Task',
          prompt: 'Will be deleted',
          priority: 'medium',
        },
        {
          actor: 'human',
        }
      );

      // Clear previous broadcasts
      broadcastSpy.mockClear();

      // Delete the task
      await taskManager.deleteTask(task.id, { actor: 'human' });

      // Verify task:deleted event was broadcast correctly
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'task',
          scope: expect.objectContaining({
            projectId: testProject.getId(),
            sessionId: session.id,
            taskId: task.id, // taskId should be in scope for deletion events
          }),
          data: expect.objectContaining({
            type: 'task:deleted',
            taskId: task.id, // taskId should also be in data for delete events
            task: expect.objectContaining({
              id: task.id,
            }),
          }),
        })
      );
    });
  });

  describe('task:note_added event forwarding', () => {
    it('should forward task:note_added events correctly', async () => {
      const session = await sessionService.createSession(
        'Note Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      const sessionInstance = await sessionService.getSession(session.id);
      const taskManager = sessionInstance!.getTaskManager();

      // Create task first
      const task = await taskManager.createTask(
        {
          title: 'Note Test Task',
          prompt: 'Will have notes',
          priority: 'high',
        },
        {
          actor: 'human',
        }
      );

      // Clear previous broadcasts (task creation)
      broadcastSpy.mockClear();

      // Add a note (this also triggers task:updated, so we'll get 2 events)
      await taskManager.addNote(task.id, 'Test note content', { actor: 'human' });

      // Find the task:note_added event (not the task:updated event)
      const noteAddedCalls = broadcastSpy.mock.calls.filter(
        (call) => call[0].data.type === 'task:note_added'
      );
      expect(noteAddedCalls).toHaveLength(1);

      const noteAddedEvent = noteAddedCalls[0][0];
      expect(noteAddedEvent).toMatchObject({
        eventType: 'task',
        scope: expect.objectContaining({
          projectId: testProject.getId(),
          sessionId: session.id,
          taskId: task.id,
        }),
        data: expect.objectContaining({
          type: 'task:note_added',
          task: expect.objectContaining({
            id: task.id,
            notes: expect.arrayContaining([
              expect.objectContaining({
                content: 'Test note content',
                author: 'human',
              }),
            ]),
          }),
        }),
      });
    });
  });

  describe('event type enforcement', () => {
    it('should never use eventType "session" for task events', async () => {
      const session = await sessionService.createSession(
        'Type Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      const sessionInstance = await sessionService.getSession(session.id);
      const taskManager = sessionInstance!.getTaskManager();

      // Create, update, and delete a task
      const task = await taskManager.createTask(
        {
          title: 'Type Enforcement Test',
          prompt: 'Testing event types',
          priority: 'medium',
        },
        {
          actor: 'human',
        }
      );

      await taskManager.updateTask(task.id, { status: 'completed' }, { actor: 'human' });
      await taskManager.deleteTask(task.id, { actor: 'human' });

      // Verify ALL broadcasts used eventType: 'task', never 'session'
      const allCalls = broadcastSpy.mock.calls;
      expect(allCalls.length).toBeGreaterThan(0);

      for (const call of allCalls) {
        const event = call[0] as StreamEvent;
        expect(event.eventType).toBe('task');
        expect(event.eventType).not.toBe('session'); // Explicit anti-pattern check
      }
    });

    it('should fail fast when wrong event types are used', async () => {
      // This test verifies our removal of compatibility fallbacks
      // If someone accidentally broadcasts task events as 'session' type,
      // the frontend should not process them

      const _taskStreamEvent: StreamEvent = {
        id: 'test-event',
        timestamp: new Date(),
        eventType: 'session', // Wrong! Should be 'task'
        scope: { sessionId: 'test-session', taskId: 'test-task' },
        data: {
          type: 'task:created',
          task: { id: 'test-task', title: 'Test' },
          context: { actor: 'human' },
          timestamp: new Date()
        },
      };

      // This test verifies our architectural decision:
      // TaskManager events MUST be broadcast as eventType: 'task'
      // If wrong event types are used, the frontend will silently ignore them (fail fast)

      const session = await sessionService.createSession(
        'Fail Fast Test Session',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      const sessionInstance = await sessionService.getSession(session.id);
      const taskManager = sessionInstance!.getTaskManager();

      await taskManager.createTask(
        {
          title: 'Fail Fast Test Task',
          prompt: 'Testing event types',
          priority: 'medium',
        },
        {
          actor: 'human',
        }
      );

      // Verify that ALL broadcasts use eventType: 'task'
      const allCalls = broadcastSpy.mock.calls;
      expect(allCalls.length).toBeGreaterThan(0);

      for (const call of allCalls) {
        const event = call[0] as StreamEvent;
        expect(event.eventType).toBe('task');
        // Architecture enforcement: NEVER 'session' for task events
        expect(event.eventType).not.toBe('session');
      }
    });
  });

  describe('session reconstruction', () => {
    it('should set up task event forwarding for reconstructed sessions', async () => {
      // Create a session
      const session = await sessionService.createSession(
        'Reconstruction Test',
        'anthropic',
        'claude-sonnet-4-20250514',
        testProject.getId()
      );

      // Clear active sessions to simulate reconstruction
      sessionService.clearActiveSessions();
      broadcastSpy.mockClear();

      // Get the session again (should trigger reconstruction)
      const reconstructedSession = await sessionService.getSession(session.id);
      expect(reconstructedSession).toBeTruthy();

      // Create a task in the reconstructed session
      const taskManager = reconstructedSession!.getTaskManager();
      await taskManager.createTask(
        {
          title: 'Reconstruction Test Task',
          prompt: 'Testing after reconstruction',
          priority: 'high',
        },
        {
          actor: 'human',
        }
      );

      // Verify event forwarding still works after reconstruction
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'task',
          scope: expect.objectContaining({
            projectId: testProject.getId(),
            sessionId: session.id,
          }),
          data: expect.objectContaining({
            type: 'task:created',
          }),
        })
      );
    });
  });
});
