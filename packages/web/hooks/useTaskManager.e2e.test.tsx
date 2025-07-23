// ABOUTME: E2E tests for TaskAPIClient with real API route handlers and persistence
// ABOUTME: Tests complete flow through TaskAPIClient to actual API routes without HTTP server

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import { TaskAPIClient } from '@/lib/client/task-api';

// Import API routes to test against
import { GET as listTasks, POST as createTask } from '@/app/api/tasks/route';
import { GET as getTask, PATCH as updateTask, DELETE as deleteTask } from '@/app/api/tasks/[taskId]/route';
import { POST as addNote } from '@/app/api/tasks/[taskId]/notes/route';
import { NextRequest } from 'next/server';

// Mock external dependencies only
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => ({
      broadcast: vi.fn(),
    }),
  },
}));

describe('TaskAPIClient E2E with Real API Routes', () => {
  let sessionId: string;
  let client: TaskAPIClient;

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
    const projectId = testProject.getId();
    const session = await sessionService.createSession(
      'TaskAPIClient E2E Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      projectId
    );
    sessionId = session.id as string;

    // Mock fetch to route requests to real API handlers
    global.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.toString();
      const method = init?.method || 'GET';
      // Convert null signal to undefined for NextRequest compatibility
      const sanitizedInit = init ? {
        ...init,
        signal: init.signal || undefined
      } : undefined;
      
      // console.log(`Mock fetch: ${method} ${urlString}`);
      
      try {
        // Route to appropriate API handler based on URL pattern
        if (urlString.includes('/api/tasks') && !urlString.includes('/notes')) {
          if (method === 'POST' && urlString === '/api/tasks') {
            const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
            return await createTask(request);
          } else if (method === 'GET' && urlString.includes('/api/tasks/') && urlString.includes('?sessionId=')) {
            // Handle GET /api/tasks/{id}?sessionId={sessionId} - this should come before the general list case
            const taskId = urlString.split('/api/tasks/')[1]?.split('?')[0];
            const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
            const response = await getTask(request, { params: { taskId: taskId! } });
            const responseData = (await response.json()) as unknown;
            return new Response(JSON.stringify(responseData), {
              status: response.status,
              headers: { 'Content-Type': 'application/json' }
            });
          } else if (method === 'GET' && urlString.includes('?sessionId=')) {
            // Handle GET /api/tasks?sessionId={sessionId} - list tasks
            const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
            return await listTasks(request);
          } else if (method === 'PATCH' && urlString.includes('/api/tasks/')) {
            const taskId = urlString.split('/api/tasks/')[1]?.split('?')[0];
            const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
            return await updateTask(request, { params: { taskId: taskId! } });
          } else if (method === 'DELETE' && urlString.includes('/api/tasks/')) {
            const taskId = urlString.split('/api/tasks/')[1]?.split('?')[0];
            const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
            return await deleteTask(request, { params: { taskId: taskId! } });
          }
        } else if (urlString.includes('/notes') && method === 'POST') {
          const taskId = urlString.split('/api/tasks/')[1]?.split('/notes')[0];
          const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
          return await addNote(request, { params: Promise.resolve({ taskId: taskId! }) });
        }
        
        throw new Error(`Unhandled API route: ${method} ${urlString}`);
      } catch (error) {
        console.error('API route error:', error);
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

  it('should create and list tasks through real API routes', async () => {
    // Create a task via TaskAPIClient -> real API route
    const createdTask = await client.createTask(sessionId, {
      title: 'E2E API Route Test Task',
      description: 'Task created via E2E test with real API routes',
      prompt: 'This is a test prompt',
      priority: 'high',
    });

    expect(createdTask.title).toBe('E2E API Route Test Task');
    expect(createdTask.priority).toBe('high');
    expect(createdTask.status).toBe('pending');

    // List tasks via TaskAPIClient -> real API route
    const tasks = await client.listTasks(sessionId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('E2E API Route Test Task');
    expect(tasks[0]?.id).toBe(createdTask.id);
  });

  it('should get, update, and delete tasks through real API routes', async () => {
    // Create a task first
    const createdTask = await client.createTask(sessionId, {
      title: 'Task for CRUD Operations',
      prompt: 'Initial task for testing CRUD',
      priority: 'medium',
    });

    // Get the specific task
    const fetchedTask = await client.getTask(sessionId, createdTask.id);
    expect(fetchedTask).toBeDefined();
    expect(fetchedTask.id).toBe(createdTask.id);
    expect(fetchedTask.title).toBe('Task for CRUD Operations');

    // Update the task
    const updatedTask = await client.updateTask(sessionId, createdTask.id, {
      title: 'Updated Task Title',
      status: 'in_progress',
      priority: 'high',
    });

    expect(updatedTask.title).toBe('Updated Task Title');
    expect(updatedTask.status).toBe('in_progress');
    expect(updatedTask.priority).toBe('high');

    // Delete the task
    await client.deleteTask(sessionId, createdTask.id);

    // Verify task was deleted
    const tasksAfterDelete = await client.listTasks(sessionId);
    expect(tasksAfterDelete).toHaveLength(0);
  });

  it('should handle task notes through real API routes', async () => {
    // Create a task first
    const createdTask = await client.createTask(sessionId, {
      title: 'Task with Notes',
      prompt: 'Task for note testing',
      priority: 'low',
    });

    // Add a note
    const taskWithNote = await client.addNote(
      sessionId,
      createdTask.id,
      'This is a test note added via E2E test'
    );

    expect(taskWithNote.notes).toHaveLength(1);
    expect(taskWithNote.notes[0]?.content).toBe('This is a test note added via E2E test');
    expect(taskWithNote.notes[0]?.author).toBeDefined();

    // Add another note
    const taskWithTwoNotes = await client.addNote(
      sessionId,
      createdTask.id,
      'Second note for testing'
    );

    expect(taskWithTwoNotes.notes).toHaveLength(2);
    expect(taskWithTwoNotes.notes[1]?.content).toBe('Second note for testing');
  });

  it('should filter tasks through real API routes', async () => {
    // Create tasks with different properties
    await client.createTask(sessionId, {
      title: 'High Priority Task',
      prompt: 'High priority task',
      priority: 'high',
    });

    const mediumTask = await client.createTask(sessionId, {
      title: 'Medium Priority Task',
      prompt: 'Medium priority task',
      priority: 'medium',
    });

    // Update one task to in_progress
    await client.updateTask(sessionId, mediumTask.id, {
      status: 'in_progress',
    });

    // Test filtering by status
    const pendingTasks = await client.listTasks(sessionId, { status: 'pending' });
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]?.priority).toBe('high');

    const inProgressTasks = await client.listTasks(sessionId, { status: 'in_progress' });
    expect(inProgressTasks).toHaveLength(1);
    expect(inProgressTasks[0]?.priority).toBe('medium');

    // Test filtering by priority
    const highPriorityTasks = await client.listTasks(sessionId, { priority: 'high' });
    expect(highPriorityTasks).toHaveLength(1);
    expect(highPriorityTasks[0]?.title).toBe('High Priority Task');
  });
});