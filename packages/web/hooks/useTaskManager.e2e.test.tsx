// ABOUTME: E2E tests for TaskAPIClient with real API route handlers and persistence
// ABOUTME: Tests complete flow through TaskAPIClient to actual API routes without HTTP server

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import { TaskAPIClient } from '@/lib/client/task-api';

// Import API routes to test against
import { GET as listTasks, POST as createTask } from '@/app/api/projects/[projectId]/sessions/[sessionId]/tasks/route';
import { GET as getTask, PATCH as updateTask, DELETE as deleteTask } from '@/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/route';
import { POST as addNote } from '@/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes/route';
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
  let projectId: string;
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
    projectId = testProject.getId();
    const session = await sessionService.createSession(
      'TaskAPIClient E2E Test Session',
      'anthropic',
      'claude-3-5-haiku-20241022',
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
        // Route to appropriate API handler based on URL pattern - RESTful nested routes
        if (urlString.includes('/api/projects/') && urlString.includes('/sessions/') && urlString.includes('/tasks')) {
          // Parse RESTful URL to extract projectId, sessionId, taskId
          // First, separate the path from query parameters
          const [urlPath, _queryString] = urlString.split('?');
          const urlParts = urlPath.split('/');
          const projectIndex = urlParts.indexOf('projects');
          const sessionIndex = urlParts.indexOf('sessions');
          const tasksIndex = urlParts.indexOf('tasks');
          
          if (projectIndex === -1 || sessionIndex === -1 || tasksIndex === -1) {
            throw new Error(`Invalid RESTful API route: ${urlString}`);
          }
          
          const routeProjectId = urlParts[projectIndex + 1];
          const routeSessionId = urlParts[sessionIndex + 1];
          const taskIdFromUrl = urlParts[tasksIndex + 1];
          
          if (!routeProjectId || !routeSessionId) {
            throw new Error(`Missing projectId or sessionId in route: ${urlString}`);
          }
          
          const request = new NextRequest('http://localhost' + urlString, sanitizedInit);
          
          if (urlPath.includes('/notes') && method === 'POST' && taskIdFromUrl) {
            // Handle POST /api/projects/{projectId}/sessions/{sessionId}/tasks/{taskId}/notes
            return await addNote(request, { 
              params: Promise.resolve({ 
                projectId: routeProjectId, 
                sessionId: routeSessionId, 
                taskId: taskIdFromUrl 
              }) 
            });
          } else if (taskIdFromUrl && !urlPath.includes('/notes')) {
            // Handle individual task operations: GET/PATCH/DELETE /api/projects/{projectId}/sessions/{sessionId}/tasks/{taskId}
            const response = await (method === 'GET' ? getTask : method === 'PATCH' ? updateTask : deleteTask)(
              request, 
              { 
                params: Promise.resolve({ 
                  projectId: routeProjectId, 
                  sessionId: routeSessionId, 
                  taskId: taskIdFromUrl 
                }) 
              }
            );
            
            if (method === 'GET') {
              const responseData = (await response.json()) as unknown;
              return new Response(JSON.stringify(responseData), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            
            return response;
          } else if (method === 'POST' && urlPath.endsWith('/tasks')) {
            // Handle POST /api/projects/{projectId}/sessions/{sessionId}/tasks
            return await createTask(request, { 
              params: Promise.resolve({ 
                projectId: routeProjectId, 
                sessionId: routeSessionId 
              }) 
            });
          } else if (method === 'GET' && urlPath.endsWith('/tasks')) {
            // Handle GET /api/projects/{projectId}/sessions/{sessionId}/tasks
            return await listTasks(request, { 
              params: Promise.resolve({ 
                projectId: routeProjectId, 
                sessionId: routeSessionId 
              }) 
            });
          }
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
    const createdTask = await client.createTask(projectId, sessionId, {
      title: 'E2E API Route Test Task',
      description: 'Task created via E2E test with real API routes',
      prompt: 'This is a test prompt',
      priority: 'high',
    });

    expect(createdTask.title).toBe('E2E API Route Test Task');
    expect(createdTask.priority).toBe('high');
    expect(createdTask.status).toBe('pending');

    // List tasks via TaskAPIClient -> real API route
    const tasks = await client.listTasks(projectId, sessionId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('E2E API Route Test Task');
    expect(tasks[0]?.id).toBe(createdTask.id);
  });

  it('should get, update, and delete tasks through real API routes', async () => {
    // Create a task first
    const createdTask = await client.createTask(projectId, sessionId, {
      title: 'Task for CRUD Operations',
      prompt: 'Initial task for testing CRUD',
      priority: 'medium',
    });

    // Get the specific task
    const fetchedTask = await client.getTask(projectId, sessionId, createdTask.id);
    expect(fetchedTask).toBeDefined();
    expect(fetchedTask.id).toBe(createdTask.id);
    expect(fetchedTask.title).toBe('Task for CRUD Operations');

    // Update the task
    const updatedTask = await client.updateTask(projectId, sessionId, createdTask.id, {
      title: 'Updated Task Title',
      status: 'in_progress',
      priority: 'high',
    });

    expect(updatedTask.title).toBe('Updated Task Title');
    expect(updatedTask.status).toBe('in_progress');
    expect(updatedTask.priority).toBe('high');

    // Delete the task
    await client.deleteTask(projectId, sessionId, createdTask.id);

    // Verify task was deleted
    const tasksAfterDelete = await client.listTasks(projectId, sessionId);
    expect(tasksAfterDelete).toHaveLength(0);
  });

  it('should handle task notes through real API routes', async () => {
    // Create a task first
    const createdTask = await client.createTask(projectId, sessionId, {
      title: 'Task with Notes',
      prompt: 'Task for note testing',
      priority: 'low',
    });

    // Add a note
    const taskWithNote = await client.addNote(
      projectId,
      sessionId,
      createdTask.id,
      'This is a test note added via E2E test'
    );

    expect(taskWithNote.notes).toHaveLength(1);
    expect(taskWithNote.notes[0]?.content).toBe('This is a test note added via E2E test');
    expect(taskWithNote.notes[0]?.author).toBeDefined();

    // Add another note
    const taskWithTwoNotes = await client.addNote(
      projectId,
      sessionId,
      createdTask.id,
      'Second note for testing'
    );

    expect(taskWithTwoNotes.notes).toHaveLength(2);
    expect(taskWithTwoNotes.notes[1]?.content).toBe('Second note for testing');
  });

  it('should filter tasks through real API routes', async () => {
    // Create tasks with different properties
    await client.createTask(projectId, sessionId, {
      title: 'High Priority Task',
      prompt: 'High priority task',
      priority: 'high',
    });

    const mediumTask = await client.createTask(projectId, sessionId, {
      title: 'Medium Priority Task',
      prompt: 'Medium priority task',
      priority: 'medium',
    });

    // Update one task to in_progress
    await client.updateTask(projectId, sessionId, mediumTask.id, {
      status: 'in_progress',
    });

    // Test filtering by status
    const pendingTasks = await client.listTasks(projectId, sessionId, { status: 'pending' });
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]?.priority).toBe('high');

    const inProgressTasks = await client.listTasks(projectId, sessionId, { status: 'in_progress' });
    expect(inProgressTasks).toHaveLength(1);
    expect(inProgressTasks[0]?.priority).toBe('medium');

    // Test filtering by priority
    const highPriorityTasks = await client.listTasks(projectId, sessionId, { priority: 'high' });
    expect(highPriorityTasks).toHaveLength(1);
    expect(highPriorityTasks[0]?.title).toBe('High Priority Task');
  });
});
