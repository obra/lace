# Task API Cleanup: RESTful Migration Implementation Plan

## Overview

This plan migrates the task management API from an inconsistent query parameter design to proper RESTful nested routes that align with the existing project/session architecture.

**Current Problem**: Task endpoints use `sessionId` as query parameters instead of proper nested routes:
- `GET /api/tasks?sessionId=xxx` 
- `GET /api/tasks/stream?sessionId=xxx`

**Target Solution**: Consistent RESTful structure:
- `GET /api/projects/[projectId]/sessions/[sessionId]/tasks`
- `GET /api/projects/[projectId]/sessions/[sessionId]/tasks/stream`

## Prerequisites & Context

### Codebase Knowledge Required
- **Event-Sourcing Architecture**: All conversations are immutable event sequences
- **Three-Layer System**: Data (ThreadManager/Persistence) → Logic (Agent/Tools) → Interface (Terminal/Web/API)
- **Task System**: Shared coordination mechanism between humans and AI agents via TaskManager
- **Session Scoping**: All tasks belong to a session (parent thread) for isolation

### Key Files to Understand Before Starting
1. `docs/design/tasks.md` - Complete task system architecture
2. `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts` - Example of proper RESTful structure
3. `src/tasks/task-manager.ts` - Core task management logic
4. `packages/web/hooks/useTaskManager.ts` - React integration patterns

### Development Rules
- **NEVER use `any` types** - Use `unknown` with type guards instead
- **NEVER mock functionality under test** - Use real code paths with real data
- **TypeScript Strict Mode** - All code must pass strict compilation
- **TDD Required** - Write failing tests first, then implement
- **Frequent Commits** - Commit after each task completion
- **DRY/YAGNI** - Don't build features we don't need yet

### Testing Philosophy
- **Unit Tests**: Individual component behavior with real dependencies
- **Integration Tests**: Cross-component interactions with real database
- **E2E Tests**: Full user workflows with real API calls
- **No Mocked Business Logic**: Only mock external services (network, filesystem)

## Implementation Tasks

### Phase 1: Preparation & Analysis

#### Task 1.1: Set up new API route structure
**Files to create**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/route.ts`
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/route.ts`
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes/route.ts`
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/stream/route.ts`

**Test-First Approach**:
1. **Write failing tests**:
   - `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/route.test.ts`
   - `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/route.test.ts`
   - `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes/route.test.ts`
   - `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/stream/route.test.ts`

2. **Test structure for each endpoint**:
```typescript
// Example test structure for tasks/route.test.ts
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks', () => {
  describe('GET', () => {
    it('should return tasks for valid project/session', async () => {
      // Use real Project.create() and Session.create()
      // No mocks - test with real database
      const project = await Project.create({ name: 'Test Project' });
      const session = await project.createSession({ name: 'Test Session' });
      
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks');
      const context = { params: Promise.resolve({ projectId: project.id, sessionId: session.id }) };
      
      const response = await GET(request, context);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('tasks');
      expect(Array.isArray(data.tasks)).toBe(true);
    });

    it('should return 404 for non-existent project', async () => {
      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions/sess1/tasks');
      const context = { params: Promise.resolve({ projectId: 'nonexistent', sessionId: 'sess1' }) };
      
      const response = await GET(request, context);
      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent session', async () => {
      const project = await Project.create({ name: 'Test Project' });
      
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/nonexistent/tasks');
      const context = { params: Promise.resolve({ projectId: project.id, sessionId: 'nonexistent' }) };
      
      const response = await GET(request, context);
      expect(response.status).toBe(404);
    });
  });

  describe('POST', () => {
    it('should create task with valid data', async () => {
      const project = await Project.create({ name: 'Test Project' });
      const session = await project.createSession({ name: 'Test Session' });
      
      const requestBody = {
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 'medium' as const,
      };
      
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const context = { params: Promise.resolve({ projectId: project.id, sessionId: session.id }) };
      
      const response = await POST(request, context);
      expect(response.status).toBe(201);
      
      const data = await response.json();
      expect(data.task).toHaveProperty('id');
      expect(data.task.title).toBe('Test Task');
    });

    it('should validate required fields', async () => {
      const project = await Project.create({ name: 'Test Project' });
      const session = await project.createSession({ name: 'Test Session' });
      
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Missing prompt' }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const context = { params: Promise.resolve({ projectId: project.id, sessionId: session.id }) };
      
      const response = await POST(request, context);
      expect(response.status).toBe(400);
    });
  });
});
```

3. **Run tests to confirm they fail**:
```bash
npm test -- packages/web/app/api/projects
```

**Implementation Details**:
- Copy logic from existing `packages/web/app/api/tasks/route.ts`
- Replace `sessionId` query parameter extraction with path parameter extraction
- Add project validation before session lookup
- Use `Project.getById()` to get project, then `project.getSession()` for session
- Maintain all existing validation and error handling

**Example implementation for tasks/route.ts**:
```typescript
// ABOUTME: RESTful task management API - list and create tasks under project/session
// ABOUTME: Provides proper nested route structure for task CRUD operations

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import type { TaskFilters } from '@/lib/server/core-types';
import type { Task, TaskStatus, TaskPriority } from '@/types/api';

interface RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId } = await context.params;

    // Get project first
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get session from project
    const session = project.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found in this project' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    // Build filters from query params (same logic as before)
    const { searchParams } = new URL(request.url);
    const filters: Partial<TaskFilters> = {};
    const status = searchParams.get('status') as TaskStatus | null;
    const priority = searchParams.get('priority') as TaskPriority | null;
    const assignedTo = searchParams.get('assignedTo');
    const createdBy = searchParams.get('createdBy');

    if (status) filters.status = status;
    if (priority) filters.priority = priority;
    if (assignedTo) filters.assignedTo = assignedTo;
    if (createdBy) filters.createdBy = createdBy;

    // Get tasks with filters
    const tasks = taskManager.getTasks(Object.keys(filters).length > 0 ? filters : undefined);

    // Convert dates to strings for JSON serialization
    const serializedTasks = tasks.map((task) => ({
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
      notes: task.notes.map((note) => ({
        ...note,
        timestamp: note.timestamp instanceof Date ? note.timestamp.toISOString() : note.timestamp,
      })),
    }));

    return NextResponse.json({ tasks: serializedTasks });
  } catch (error: unknown) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId } = await context.params;
    
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      prompt?: string;
      priority?: TaskPriority;
      assignedTo?: string;
    };
    const { title, description, prompt, priority, assignedTo } = body;

    if (!title || !prompt) {
      return NextResponse.json({ error: 'Title and prompt are required' }, { status: 400 });
    }

    // Get project first
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get session from project
    const session = project.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found in this project' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    // Create task with human context (same logic as before)
    const createRequest = {
      title,
      prompt,
      priority: priority || 'medium',
      ...(description && { description }),
      ...(assignedTo && { assignedTo }),
    };

    const task = await taskManager.createTask(
      createRequest as Parameters<typeof taskManager.createTask>[0],
      {
        actor: 'human',
        isHuman: true,
      }
    );

    // Convert dates to strings for JSON serialization
    const serializedTask: Task = {
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
      notes: task.notes.map((note) => ({
        ...note,
        timestamp: note.timestamp instanceof Date ? note.timestamp.toISOString() : note.timestamp,
      })),
    };

    return NextResponse.json({ task: serializedTask }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
```

**Commit checkpoint**: "feat: add RESTful task API endpoints with tests"

#### Task 1.2: Update task detail endpoint
**Files to modify**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/route.ts`

**Test-First Approach**:
```typescript
// Test structure for [taskId]/route.test.ts
describe('GET /api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]', () => {
  it('should return specific task', async () => {
    const project = await Project.create({ name: 'Test Project' });
    const session = await project.createSession({ name: 'Test Session' });
    const taskManager = session.getTaskManager();
    
    const task = await taskManager.createTask({
      title: 'Test Task',
      prompt: 'Test prompt',
      priority: 'medium',
    }, { actor: 'human', isHuman: true });

    const request = new NextRequest(`http://localhost/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}`);
    const context = { 
      params: Promise.resolve({ 
        projectId: project.id, 
        sessionId: session.id, 
        taskId: task.id 
      }) 
    };

    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.task.id).toBe(task.id);
    expect(data.task.title).toBe('Test Task');
  });

  it('should return 404 for non-existent task', async () => {
    const project = await Project.create({ name: 'Test Project' });
    const session = await project.createSession({ name: 'Test Session' });

    const request = new NextRequest(`http://localhost/api/projects/${project.id}/sessions/${session.id}/tasks/nonexistent`);
    const context = { 
      params: Promise.resolve({ 
        projectId: project.id, 
        sessionId: session.id, 
        taskId: 'nonexistent' 
      }) 
    };

    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]', () => {
  it('should update task properties', async () => {
    const project = await Project.create({ name: 'Test Project' });
    const session = await project.createSession({ name: 'Test Session' });
    const taskManager = session.getTaskManager();
    
    const task = await taskManager.createTask({
      title: 'Original Title',
      prompt: 'Test prompt',
      priority: 'medium',
    }, { actor: 'human', isHuman: true });

    const updateData = { title: 'Updated Title', status: 'in_progress' as const };

    const request = new NextRequest(`http://localhost/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
      headers: { 'Content-Type': 'application/json' },
    });

    const context = { 
      params: Promise.resolve({ 
        projectId: project.id, 
        sessionId: session.id, 
        taskId: task.id 
      }) 
    };

    const response = await PATCH(request, context);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.task.title).toBe('Updated Title');
    expect(data.task.status).toBe('in_progress');
  });
});
```

**Implementation**: Copy from existing `packages/web/app/api/tasks/[taskId]/route.ts`, replacing query parameter extraction with path parameter validation.

**Commit checkpoint**: "feat: add RESTful task detail endpoint with tests"

#### Task 1.3: Update task notes endpoint
**Files to modify**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes/route.ts`

**Test structure**: Similar pattern, testing note creation on existing tasks.

**Commit checkpoint**: "feat: add RESTful task notes endpoint with tests"

#### Task 1.4: Update SSE stream endpoint
**Files to modify**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/stream/route.ts`

**Special considerations**:
- SSE endpoints require different test approach
- Test connection establishment and basic event flow
- Use real TaskManager events, not mocks

**Test example**:
```typescript
describe('GET /api/projects/[projectId]/sessions/[sessionId]/tasks/stream', () => {
  it('should establish SSE connection', async () => {
    const project = await Project.create({ name: 'Test Project' });
    const session = await project.createSession({ name: 'Test Session' });

    const request = new NextRequest(`http://localhost/api/projects/${project.id}/sessions/${session.id}/tasks/stream`);
    const context = { 
      params: Promise.resolve({ 
        projectId: project.id, 
        sessionId: session.id 
      }) 
    };

    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('should stream task events', async () => {
    // Test requires more complex setup to verify actual event streaming
    // Use AbortController to manage connection lifecycle
    // Verify task creation events are streamed to connected clients
  });
});
```

**Commit checkpoint**: "feat: add RESTful task SSE stream endpoint with tests"

### Phase 2: React Integration Updates

#### Task 2.1: Update useTaskManager hook
**Files to modify**:
- `packages/web/hooks/useTaskManager.ts`

**Current signature**:
```typescript
function useTaskManager(sessionId: string): {
  // hook methods
}
```

**New signature**:
```typescript
function useTaskManager(projectId: string, sessionId: string): {
  // hook methods
}
```

**Test-First Approach**:
```typescript
// packages/web/hooks/useTaskManager.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useTaskManager } from '../useTaskManager';

describe('useTaskManager', () => {
  it('should fetch tasks from new API endpoint', async () => {
    // Mock fetch to return successful response
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tasks: [] }),
    });

    const { result } = renderHook(() => useTaskManager('project1', 'session1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project1/sessions/session1/tasks',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('should create tasks via new API endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task: { id: 'task1', title: 'Test Task' } }),
    });

    const { result } = renderHook(() => useTaskManager('project1', 'session1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.createTask({
      title: 'Test Task',
      prompt: 'Test prompt',
      priority: 'medium',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project1/sessions/session1/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Task',
          prompt: 'Test prompt',
          priority: 'medium',
        }),
      })
    );
  });
});
```

**Implementation changes**:
- Update all API calls to use new URL structure
- Replace `/api/tasks?sessionId=${sessionId}` with `/api/projects/${projectId}/sessions/${sessionId}/tasks`
- Update error handling to account for project validation errors
- Maintain backward compatibility with existing state management

**Commit checkpoint**: "feat: update useTaskManager for RESTful API endpoints"

#### Task 2.2: Update useTaskStream hook
**Files to modify**:
- `packages/web/hooks/useTaskStream.ts`

**Changes required**:
- Update SSE connection URL from `/api/tasks/stream?sessionId=${sessionId}` to `/api/projects/${projectId}/sessions/${sessionId}/tasks/stream`
- Add projectId parameter to hook signature
- Update connection error handling

**Test approach**:
```typescript
// packages/web/hooks/useTaskStream.test.ts
describe('useTaskStream', () => {
  it('should connect to new SSE endpoint', () => {
    const mockEventSource = {
      addEventListener: jest.fn(),
      close: jest.fn(),
    };
    
    // Mock EventSource constructor
    global.EventSource = jest.fn().mockImplementation(() => mockEventSource);

    const { result } = renderHook(() => useTaskStream('project1', 'session1', {}));

    expect(global.EventSource).toHaveBeenCalledWith(
      '/api/projects/project1/sessions/session1/tasks/stream'
    );
  });
});
```

**Commit checkpoint**: "feat: update useTaskStream for RESTful SSE endpoint"

### Phase 3: Component Updates

#### Task 3.1: Update all React components
**Files to modify**:
- `packages/web/components/TaskDashboard.tsx`
- `packages/web/components/TaskList.tsx`
- `packages/web/components/TaskListItem.tsx`
- `packages/web/components/TaskDetailModal.tsx`
- `packages/web/components/CreateTaskModal.tsx`
- Any other components using task hooks

**Pattern for updates**:
1. Add projectId prop to component interfaces
2. Pass projectId through to hooks
3. Update prop drilling as needed

**Test approach**:
- Update existing component tests to pass required projectId
- Verify components render correctly with new props
- Test that hook integration still works

**Example component update**:
```typescript
// Before
interface TaskDashboardProps {
  sessionId: string;
}

export function TaskDashboard({ sessionId }: TaskDashboardProps) {
  const { tasks, loading } = useTaskManager(sessionId);
  // ...
}

// After
interface TaskDashboardProps {
  projectId: string;
  sessionId: string;
}

export function TaskDashboard({ projectId, sessionId }: TaskDashboardProps) {
  const { tasks, loading } = useTaskManager(projectId, sessionId);
  // ...
}
```

**Commit checkpoint**: "feat: update React components for RESTful task API"

### Phase 4: Integration & Cleanup

#### Task 4.1: Integration testing
**Files to create**:
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/integration.test.ts`

**Test scope**:
- Full CRUD operations across all endpoints
- SSE event propagation
- Error handling across the stack
- Project/session validation workflow

**Example integration test**:
```typescript
describe('Task API Integration', () => {
  it('should handle complete task lifecycle', async () => {
    // 1. Create project and session
    const project = await Project.create({ name: 'Integration Test Project' });
    const session = await project.createSession({ name: 'Integration Test Session' });

    // 2. Create task via API
    const createResponse = await fetch(`/api/projects/${project.id}/sessions/${session.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Integration Test Task',
        prompt: 'Test prompt for integration',
        priority: 'high',
      }),
    });
    
    expect(createResponse.status).toBe(201);
    const { task } = await createResponse.json();

    // 3. Fetch task via API
    const getResponse = await fetch(`/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}`);
    expect(getResponse.status).toBe(200);
    const { task: fetchedTask } = await getResponse.json();
    expect(fetchedTask.title).toBe('Integration Test Task');

    // 4. Update task via API
    const updateResponse = await fetch(`/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    
    expect(updateResponse.status).toBe(200);
    const { task: updatedTask } = await updateResponse.json();
    expect(updatedTask.status).toBe('completed');

    // 5. Add note via API
    const noteResponse = await fetch(`/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Integration test note' }),
    });
    
    expect(noteResponse.status).toBe(201);

    // 6. Delete task via API
    const deleteResponse = await fetch(`/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}`, {
      method: 'DELETE',
    });
    
    expect(deleteResponse.status).toBe(200);

    // 7. Verify task is deleted
    const verifyResponse = await fetch(`/api/projects/${project.id}/sessions/${session.id}/tasks/${task.id}`);
    expect(verifyResponse.status).toBe(404);
  });
});
```

**Commit checkpoint**: "test: add comprehensive task API integration tests"

#### Task 4.2: Remove old endpoints completely
**Files to delete**:
- `packages/web/app/api/tasks/route.ts`
- `packages/web/app/api/tasks/[taskId]/route.ts`
- `packages/web/app/api/tasks/[taskId]/notes/route.ts`
- `packages/web/app/api/tasks/stream/route.ts`
- `packages/web/app/api/tasks/[taskId]/route.test.ts`
- `packages/web/app/api/tasks/route.test.ts`
- `packages/web/app/api/tasks/[taskId]/notes/route.test.ts`
- `packages/web/app/api/tasks/stream/route.test.ts`

**Approach**:
1. Delete all old API endpoint files completely
2. Remove old test files
3. Clean up any unused imports or references

**Verification**:
- Run `npm run build` to ensure no broken imports
- Run full test suite to verify no tests depend on old endpoints
- Search codebase for any remaining references to old URLs

**Commit checkpoint**: "feat: remove old task API endpoints completely"

#### Task 4.3: Update documentation
**Files to modify**:
- `docs/design/tasks.md`
- Update API endpoint documentation
- Update usage examples in documentation

**Changes needed**:
- Update all API endpoint URLs in documentation
- Update code examples to use new URL structure
- Add migration guide for existing implementations

**Commit checkpoint**: "docs: update task API documentation for RESTful endpoints"

#### Task 4.4: End-to-end testing
**Files to create**:
- `tests/e2e/task-management.spec.ts` (if E2E framework exists)

**Test scenarios**:
- Complete user workflow: create project → create session → manage tasks
- Multi-user task collaboration (if supported)
- Real-time updates across multiple browser tabs
- Error handling in realistic scenarios

**Commit checkpoint**: "test: add end-to-end tests for RESTful task management"

### Phase 5: Performance & Production

#### Task 5.1: Performance verification
**Activities**:
- Load test new endpoints with realistic data volumes
- Verify SSE connection handling under load
- Check database query performance with nested lookups
- Memory usage analysis for long-running SSE connections

**Files to create**:
- `docs/performance/task-api-benchmarks.md`

**Commit checkpoint**: "perf: verify RESTful task API performance characteristics"

#### Task 5.2: Security review
**Activities**:
- Verify project/session access control
- Check for parameter injection vulnerabilities
- Validate all input sanitization
- Review authentication/authorization flow

**Commit checkpoint**: "security: verify RESTful task API security controls"

## Testing Commands

### Run specific test suites
```bash
# Unit tests for new API endpoints
npm test -- packages/web/app/api/projects --verbose

# React hook tests
npm test -- packages/web/hooks --verbose

# Component tests
npm test -- packages/web/components --verbose

# Integration tests
npm test -- packages/web/app/api/projects --testNamePattern="integration"

# All task-related tests
npm test -- --testNamePattern="task"
```

### Verify TypeScript compilation
```bash
# Compile entire project
npm run build

# Type-check only (faster)
npx tsc --noEmit
```

### Run linting
```bash
npm run lint
npm run lint:fix
```

## Common TypeScript Patterns for This Migration

### Type Guards Instead of `any`
```typescript
// WRONG - never use any
function processResponse(data: any) {
  return data.tasks;
}

// RIGHT - use unknown with type guards
function isTaskResponse(data: unknown): data is { tasks: Task[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'tasks' in data &&
    Array.isArray((data as { tasks: unknown }).tasks)
  );
}

function processResponse(data: unknown): Task[] {
  if (!isTaskResponse(data)) {
    throw new Error('Invalid task response format');
  }
  return data.tasks;
}
```

### Proper Error Handling
```typescript
// WRONG - catching unknown as any
try {
  await someOperation();
} catch (error: any) {
  console.log(error.message);
}

// RIGHT - proper unknown error handling
try {
  await someOperation();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error occurred';
  console.log(message);
}
```

### Route Parameter Validation
```typescript
// WRONG - assuming params are correct type
export async function GET(request: NextRequest, { params }: { params: { projectId: string } }) {
  const project = Project.getById(params.projectId);
  // ...
}

// RIGHT - await params and validate
export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
) {
  const { projectId, sessionId } = await params;
  
  if (!projectId || !sessionId) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }
  
  const project = Project.getById(projectId);
  // ...
}
```

## Troubleshooting Guide

### Common Issues

**Issue**: Tests fail with "Cannot find module" errors
**Solution**: Verify import paths use `@/` prefix for absolute imports, check `tsconfig.json` path mapping

**Issue**: TypeScript compilation errors about parameter types
**Solution**: Use proper `Promise<{ param: string }>` types for Next.js route parameters

**Issue**: Database connection errors in tests
**Solution**: Ensure test database is properly initialized, check if migrations are applied

**Issue**: SSE tests timing out
**Solution**: Use proper AbortController cleanup, set reasonable test timeouts

**Issue**: React hook tests failing
**Solution**: Verify all required providers are wrapped around test components

### Development Workflow

1. **Start each task by writing failing tests**
2. **Run tests to confirm they fail for the right reasons**
3. **Implement minimal code to make tests pass**
4. **Refactor while keeping tests green**
5. **Commit frequently with descriptive messages**
6. **Run full test suite before pushing**

### Code Review Checklist

- [ ] No `any` types used anywhere
- [ ] All errors properly typed as `unknown` and handled
- [ ] Tests use real dependencies, not mocks of business logic
- [ ] All async operations properly awaited
- [ ] TypeScript strict mode passes
- [ ] ESLint passes without warnings
- [ ] Integration tests cover main user workflows
- [ ] API endpoints return consistent error formats
- [ ] All commits have descriptive messages
- [ ] Documentation updated to match implementation

## Success Criteria

### Functional Requirements
- [ ] All task API endpoints moved to RESTful nested routes
- [ ] React components work with new API structure
- [ ] SSE streaming works with new endpoints
- [ ] Old endpoints return helpful deprecation messages
- [ ] All existing functionality preserved

### Quality Requirements
- [ ] 100% test coverage on new API endpoints
- [ ] All tests use real dependencies where possible
- [ ] No TypeScript compilation errors
- [ ] No ESLint warnings
- [ ] Performance equivalent or better than old API
- [ ] Documentation completely updated

### Timeline Estimate
- **Phase 1**: 3-4 days (API endpoints + tests)
- **Phase 2**: 2-3 days (React integration)
- **Phase 3**: 1-2 days (Component updates)
- **Phase 4**: 2-3 days (Integration + cleanup)
- **Phase 5**: 1-2 days (Performance + security)

**Total: 9-14 days** for a developer unfamiliar with the codebase

This plan assumes working in small, testable increments with frequent commits and constant verification. Each phase builds on the previous one and can be validated independently.