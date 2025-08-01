// ABOUTME: E2E tests for TaskAPIClient with real API route handlers and database persistence
// ABOUTME: Tests client making real API calls that go through actual route handlers with real database

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskAPIClient } from '@/lib/client/task-api';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';

// Import API routes to test against
import {
  GET as listTasks,
  POST as createTask,
} from '@/app/api/projects/[projectId]/sessions/[sessionId]/tasks/route';
import {
  GET as getTask,
  PATCH as updateTask,
  DELETE as deleteTask,
} from '@/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/route';
import { POST as addNote } from '@/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes/route';
import { NextRequest } from 'next/server';

// Mock external dependencies only
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

vi.mock('@/lib/event-stream-manager', () => ({
  EventStreamManager: {
    getInstance: () => ({
      broadcast: vi.fn(),
    }),
  },
}));

describe('TaskAPIClient E2E Tests', () => {
  let client: TaskAPIClient;
  let sessionId: string;
  let projectId: string;

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment for session service
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    // Create a real session using the session service
    const sessionService = getSessionService();
    const testProject = Project.create(
      'TaskAPIClient E2E Test Project',
      '/test/path',
      'Test project for TaskAPIClient E2E testing',
      {}
    );
    projectId = testProject.getId();
    const session = await sessionService.createSession(
      'TaskAPIClient E2E Test Session',
      'anthropic',
      'claude-3-5-haiku-20241022',
      projectId
    );
    // Extract string value from ThreadId branded type
    sessionId = session.id as string;

    // Mock fetch to route requests to real API handlers (same pattern as useTaskManager.e2e.test.tsx)
    global.fetch = vi
      .fn()
      .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlString = typeof url === 'string' ? url : url.toString();
        const method = init?.method || 'GET';
        // Convert null signal to undefined for NextRequest compatibility
        const sanitizedInit = init
          ? {
              ...init,
              signal: init.signal || undefined,
            }
          : undefined;

        try {
          // Route to appropriate API handler based on URL pattern
          if (
            urlString.includes('/api/projects/') &&
            urlString.includes('/sessions/') &&
            urlString.includes('/tasks')
          ) {
            // Extract projectId, sessionId, and taskId from URL (ignoring query parameters)
            const urlPath = urlString.split('?')[0]; // Remove query parameters
            const urlParts = urlPath.split('/');
            const projectIdIndex = urlParts.indexOf('projects') + 1;
            const sessionIdIndex = urlParts.indexOf('sessions') + 1;
            const tasksIndex = urlParts.indexOf('tasks');

            const extractedProjectId = urlParts[projectIdIndex];
            const extractedSessionId = urlParts[sessionIdIndex];

            if (method === 'POST' && urlString.endsWith('/tasks')) {
              // Handle POST /api/projects/{projectId}/sessions/{sessionId}/tasks
              const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
              return await createTask(request, {
                params: Promise.resolve({
                  projectId: extractedProjectId!,
                  sessionId: extractedSessionId!,
                }),
              });
            } else if (method === 'GET' && urlParts.length === tasksIndex + 1) {
              // Handle GET /api/projects/{projectId}/sessions/{sessionId}/tasks[?params]
              const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
              return await listTasks(request, {
                params: Promise.resolve({
                  projectId: extractedProjectId!,
                  sessionId: extractedSessionId!,
                }),
              });
            } else if (
              method === 'GET' &&
              urlParts.length > tasksIndex + 1 &&
              !urlString.includes('/notes')
            ) {
              // Handle GET /api/projects/{projectId}/sessions/{sessionId}/tasks/{taskId}
              const taskId = urlParts[tasksIndex + 1];
              const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
              const response = await getTask(request, {
                params: Promise.resolve({
                  projectId: extractedProjectId!,
                  sessionId: extractedSessionId!,
                  taskId: taskId!,
                }),
              });
              const responseData = (await response.json()) as unknown;
              return new Response(JSON.stringify(responseData), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
              });
            } else if (
              method === 'PATCH' &&
              urlParts.length > tasksIndex + 1 &&
              !urlString.includes('/notes')
            ) {
              // Handle PATCH /api/projects/{projectId}/sessions/{sessionId}/tasks/{taskId}
              const taskId = urlParts[tasksIndex + 1];
              const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
              return await updateTask(request, {
                params: Promise.resolve({
                  projectId: extractedProjectId!,
                  sessionId: extractedSessionId!,
                  taskId: taskId!,
                }),
              });
            } else if (
              method === 'DELETE' &&
              urlParts.length > tasksIndex + 1 &&
              !urlString.includes('/notes')
            ) {
              // Handle DELETE /api/projects/{projectId}/sessions/{sessionId}/tasks/{taskId}
              const taskId = urlParts[tasksIndex + 1];
              const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
              return await deleteTask(request, {
                params: Promise.resolve({
                  projectId: extractedProjectId!,
                  sessionId: extractedSessionId!,
                  taskId: taskId!,
                }),
              });
            } else if (method === 'POST' && urlString.includes('/notes')) {
              // Handle POST /api/projects/{projectId}/sessions/{sessionId}/tasks/{taskId}/notes
              const taskId = urlParts[tasksIndex + 1];
              const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
              return await addNote(request, {
                params: Promise.resolve({
                  projectId: extractedProjectId!,
                  sessionId: extractedSessionId!,
                  taskId: taskId!,
                }),
              });
            }
          }

          throw new Error(`Unhandled API route: ${method} ${urlString}`);
        } catch (error) {
          // API route error - rethrow for test handling
          throw error;
        }
      });

    client = new TaskAPIClient();
  });

  afterEach(() => {
    teardownTestPersistence();
    vi.clearAllMocks();
    if (global.sessionService) {
      global.sessionService = undefined;
    }
  });

  describe('Task CRUD Operations', () => {
    it('should create and list tasks', async () => {
      // Create a task
      const newTask = await client.createTask(projectId, sessionId, {
        title: 'E2E Test Task',
        description: 'Task created via E2E test',
        prompt: 'This is a test prompt',
        priority: 'high',
      });

      expect(newTask.title).toBe('E2E Test Task');
      expect(newTask.description).toBe('Task created via E2E test');
      expect(newTask.priority).toBe('high');
      expect(newTask.status).toBe('pending');

      // List tasks to verify it was created
      const tasks = await client.listTasks(projectId, sessionId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.title).toBe('E2E Test Task');
      expect(tasks[0]?.id).toBe(newTask.id);
    });

    it('should get a specific task', async () => {
      // Create a task first
      const createdTask = await client.createTask(projectId, sessionId, {
        title: 'Task to Fetch',
        prompt: 'Test prompt for fetching',
        priority: 'medium',
      });

      // Get the specific task
      const fetchedTask = await client.getTask(projectId, sessionId, createdTask.id);

      expect(fetchedTask.id).toBe(createdTask.id);
      expect(fetchedTask.title).toBe('Task to Fetch');
      expect(fetchedTask.priority).toBe('medium');
    });

    it('should update a task', async () => {
      // Create a task first
      const createdTask = await client.createTask(projectId, sessionId, {
        title: 'Task to Update',
        prompt: 'Initial task',
        priority: 'low',
      });

      // Update the task
      const updatedTask = await client.updateTask(projectId, sessionId, createdTask.id, {
        title: 'Updated Task Title',
        status: 'in_progress',
        priority: 'high',
      });

      expect(updatedTask.id).toBe(createdTask.id);
      expect(updatedTask.title).toBe('Updated Task Title');
      expect(updatedTask.status).toBe('in_progress');
      expect(updatedTask.priority).toBe('high');

      // Verify the update persisted by fetching again
      const fetchedTask = await client.getTask(projectId, sessionId, createdTask.id);
      expect(fetchedTask.title).toBe('Updated Task Title');
      expect(fetchedTask.status).toBe('in_progress');
    });

    it('should delete a task', async () => {
      // Create a task first
      const createdTask = await client.createTask(projectId, sessionId, {
        title: 'Task to Delete',
        prompt: 'This task will be deleted',
        priority: 'low',
      });

      // Verify task exists
      let tasks = await client.listTasks(projectId, sessionId);
      expect(tasks).toHaveLength(1);

      // Delete the task
      await client.deleteTask(projectId, sessionId, createdTask.id);

      // Verify task was deleted
      tasks = await client.listTasks(projectId, sessionId);
      expect(tasks).toHaveLength(0);
    });
  });

  describe('Task Notes', () => {
    it('should add notes to tasks', async () => {
      // Create a task first
      const createdTask = await client.createTask(projectId, sessionId, {
        title: 'Task with Notes',
        prompt: 'Task for note testing',
        priority: 'medium',
      });

      // Add a note
      const taskWithNote = await client.addNote(
        projectId,
        sessionId,
        createdTask.id,
        'This is a test note'
      );

      expect(taskWithNote.notes).toHaveLength(1);
      expect(taskWithNote.notes[0]?.content).toBe('This is a test note');
      expect(taskWithNote.notes[0]?.author).toBeDefined();
      expect(taskWithNote.notes[0]?.timestamp).toBeDefined();

      // Add another note
      const taskWithTwoNotes = await client.addNote(
        projectId,
        sessionId,
        createdTask.id,
        'Second note'
      );

      expect(taskWithTwoNotes.notes).toHaveLength(2);
      expect(taskWithTwoNotes.notes[1]?.content).toBe('Second note');
    });
  });

  describe('Task Filtering', () => {
    beforeEach(async () => {
      // Create multiple tasks with different properties for filtering tests
      await client.createTask(projectId, sessionId, {
        title: 'High Priority Pending Task',
        prompt: 'High priority task',
        priority: 'high',
      });

      const mediumTask = await client.createTask(projectId, sessionId, {
        title: 'Medium Priority Task',
        prompt: 'Medium priority task',
        priority: 'medium',
      });

      // Update one task to in_progress status
      await client.updateTask(projectId, sessionId, mediumTask.id, {
        status: 'in_progress',
      });

      await client.createTask(projectId, sessionId, {
        title: 'Low Priority Task',
        prompt: 'Low priority task',
        priority: 'low',
      });
    });

    it('should filter tasks by status', async () => {
      const pendingTasks = await client.listTasks(projectId, sessionId, { status: 'pending' });
      expect(pendingTasks).toHaveLength(2);
      expect(pendingTasks.every((task) => task.status === 'pending')).toBe(true);

      const inProgressTasks = await client.listTasks(projectId, sessionId, {
        status: 'in_progress',
      });
      expect(inProgressTasks).toHaveLength(1);
      expect(inProgressTasks[0]?.status).toBe('in_progress');
    });

    it('should filter tasks by priority', async () => {
      const highPriorityTasks = await client.listTasks(projectId, sessionId, { priority: 'high' });
      expect(highPriorityTasks).toHaveLength(1);
      expect(highPriorityTasks[0]?.priority).toBe('high');

      const lowPriorityTasks = await client.listTasks(projectId, sessionId, { priority: 'low' });
      expect(lowPriorityTasks).toHaveLength(1);
      expect(lowPriorityTasks[0]?.priority).toBe('low');
    });

    it('should filter tasks by multiple criteria', async () => {
      const filteredTasks = await client.listTasks(projectId, sessionId, {
        status: 'pending',
        priority: 'high',
      });

      expect(filteredTasks).toHaveLength(1);
      expect(filteredTasks[0]?.status).toBe('pending');
      expect(filteredTasks[0]?.priority).toBe('high');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid task IDs', async () => {
      await expect(client.getTask(projectId, sessionId, 'invalid-task-id')).rejects.toThrow();
    });

    it('should handle invalid session IDs', async () => {
      await expect(client.listTasks(projectId, 'invalid-session-id')).rejects.toThrow();
    });

    it('should handle malformed requests', async () => {
      await expect(
        client.createTask(projectId, sessionId, {
          title: '', // Empty title should fail validation
          prompt: '',
        })
      ).rejects.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      // Temporarily break the fetch function to simulate network error
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(client.listTasks(projectId, sessionId)).rejects.toThrow();

      // Restore fetch
      global.fetch = originalFetch;
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent task creation', async () => {
      // Create multiple tasks concurrently
      const taskPromises = Array.from({ length: 5 }, (_, i) =>
        client.createTask(projectId, sessionId, {
          title: `Concurrent Task ${i + 1}`,
          prompt: `Concurrent task prompt ${i + 1}`,
          priority: 'medium',
        })
      );

      const createdTasks = await Promise.all(taskPromises);

      expect(createdTasks).toHaveLength(5);
      createdTasks.forEach((task, i) => {
        expect(task.title).toBe(`Concurrent Task ${i + 1}`);
      });

      // Verify all tasks were persisted
      const allTasks = await client.listTasks(projectId, sessionId);
      expect(allTasks).toHaveLength(5);
    });

    it('should handle concurrent updates to different tasks', async () => {
      // Create two tasks
      const task1 = await client.createTask(projectId, sessionId, {
        title: 'Task 1',
        prompt: 'First task',
        priority: 'high',
      });

      const task2 = await client.createTask(projectId, sessionId, {
        title: 'Task 2',
        prompt: 'Second task',
        priority: 'low',
      });

      // Update both tasks concurrently
      const [updatedTask1, updatedTask2] = await Promise.all([
        client.updateTask(projectId, sessionId, task1.id, { status: 'in_progress' }),
        client.updateTask(projectId, sessionId, task2.id, { status: 'completed' }),
      ]);

      expect(updatedTask1.status).toBe('in_progress');
      expect(updatedTask2.status).toBe('completed');
    });
  });
});
