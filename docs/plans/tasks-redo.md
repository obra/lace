# Task Manager Human UI Implementation Plan

## Overview

This plan implements a human-visible web UI for the task manager system. Currently, tasks can only be managed through agent tools - we need to lift the task manager to be a first-class core service accessible to both agents and humans.

## Context for Engineers

### What is Lace?
- AI coding assistant with event-sourcing architecture
- Supports multiple AI agents working together on projects
- Built with TypeScript, Node.js, SQLite, React/Next.js for web UI
- Agents communicate through a shared task queue (not direct messaging)

### Development Discipline

**CRITICAL: Follow TDD strictly for every task**
1. **Write tests first** - Always write failing tests before implementation
2. **Verify tests fail** - Run tests to confirm they fail as expected
3. **Implement minimal code** - Write only enough code to make tests pass
4. **Verify tests pass** - Run tests to confirm they now pass
5. **Refactor if needed** - Clean up code while keeping tests green
6. **Lint clean** - Ensure code passes linting before committing

**Before every commit:**
```bash
# Run tests
npm test [relevant-test-file]

# Run linting
npm run lint

# Fix any linting issues
npm run lint:fix

# Build to check for type errors
npm run build
```

**Commit only when:**
- [ ] All tests pass
- [ ] Linting is clean
- [ ] TypeScript compiles without errors
- [ ] Code follows existing patterns

### TDD Checklist for Every Task

**FOR EVERY SINGLE TASK - NO EXCEPTIONS:**

**Step 1: Write Tests First**
- [ ] Create test file with failing tests
- [ ] Tests cover all requirements
- [ ] Tests are specific and focused
- [ ] Run tests to verify they fail as expected

**Step 2: Implement Minimal Code**
- [ ] Write ONLY enough code to make tests pass
- [ ] No extra features beyond test requirements
- [ ] Follow existing code patterns
- [ ] Use existing utilities where possible

**Step 3: Verify Success**
- [ ] All tests pass: `npm test [test-file]`
- [ ] Linting passes: `npm run lint`
- [ ] TypeScript compiles: `npm run build`
- [ ] No console errors or warnings

**Step 4: Commit**
- [ ] Add clear commit message
- [ ] Include only related changes
- [ ] Reference task number/description

**Step 5: Refactor (if needed)**
- [ ] Keep tests green during refactoring
- [ ] Improve code quality without changing behavior
- [ ] Run full test suite after refactoring

### Current State
- Task manager exists as agent-only tools (`src/tools/implementations/task-manager/`)
- Full multi-agent support with SQLite persistence
- Rich data model with status, priority, notes, thread-based assignment
- 6 tool classes: create, list, complete, update, add-note, view
- No human-accessible APIs - all operations through agent tool calls

### Goal
Create web UI for humans to:
- View all tasks across agents in a session
- Create, edit, assign, and complete tasks
- Add notes and communicate with agents
- Monitor task progress in real-time

## Architecture Overview

### Key Concepts
- **Sessions**: Top-level containers (maps to parent thread like `lace_20250714_abc123`)
- **Primary Agent**: The main AI agent in a session (represented by session ID)
- **Delegate Agents**: Additional AI agents spawned within session (child threads like `lace_20250714_abc123.1`)
- **Human Users**: Human participants who create sessions and manage tasks
- **Tasks**: Work items that can be assigned to agents or humans
- **Thread IDs**: Hierarchical identifiers for agents (`parent.child.grandchild`)
- **User IDs**: Identifier for human users (current: `${sessionId}:human`, future: `user:alice`)

### Data Model (Already Implemented)
```typescript
interface Task {
  id: string;                    // task_YYYYMMDD_random
  title: string;                 // Brief summary
  description: string;           // Human-readable details
  prompt: string;                // Instructions for assigned agent
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: string;           // ThreadId, "sessionId:human", or "new:provider/model"
  createdBy: string;             // ThreadId of creator or "sessionId:human"
  threadId: string;              // Parent thread (session)
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];
}

interface TaskNote {
  id: string;
  author: string;                // ThreadId of note author or "sessionId:human"
  content: string;
  timestamp: Date;
}
```

### Technology Stack
- **Backend**: Node.js, TypeScript, SQLite (better-sqlite3)
- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **Real-time**: Server-Sent Events (SSE)
- **Testing**: Vitest, React Testing Library

## Phase 1: Core Task System

### Task 1.1: Create Task Manager

**Objective**: Create session-scoped task management system

**Files to Create**:
- `src/tasks/task-manager.ts` - Core task management system
- `src/tasks/types.ts` - Task type definitions
- `src/tasks/__tests__/task-manager.test.ts` - Core system tests

**Files to Modify**:
- `src/tools/implementations/task-manager/tools.ts` - Use session's TaskManager
- `src/sessions/session.ts` - Add TaskManager to session (if session class exists)

**Implementation**:

1. **Create task types** (`src/tasks/types.ts`):
```typescript
export interface Task {
  id: string;                    // task_YYYYMMDD_random
  title: string;                 // Brief summary
  description: string;           // Human-readable details
  prompt: string;                // Instructions for assigned agent
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: string;           // ThreadId, "sessionId:human", or "new:provider/model"
  createdBy: string;             // ThreadId of creator or "sessionId:human"
  sessionId: string;             // Session this task belongs to
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];
}

export interface TaskNote {
  id: string;
  author: string;                // ThreadId of note author or "sessionId:human"
  content: string;
  timestamp: Date;
}

export interface TaskContext {
  actor: string;                 // Who is performing the action
  isHuman?: boolean;            // Quick check for human vs agent
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  prompt: string;
  priority?: 'high' | 'medium' | 'low';
  assignedTo?: string;
}

export interface TaskFilters {
  status?: Task['status'];
  priority?: Task['priority'];
  assignedTo?: string;
  createdBy?: string;
}

export interface TaskSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}
```

2. **Create TaskManager** (`src/tasks/task-manager.ts`):
```typescript
import { DatabasePersistence } from '../persistence/database.js';
import { Task, TaskNote, CreateTaskRequest, TaskFilters, TaskContext, TaskSummary } from './types.js';

export class TaskManager {
  constructor(
    private sessionId: string,
    private persistence: DatabasePersistence
  ) {}

  async createTask(request: CreateTaskRequest, context: TaskContext): Promise<Task> {
    // Validate request
    // Generate task ID
    // Set creator and session context
    // Save to database
    // Return task
  }

  async getTasks(filters?: TaskFilters): Promise<Task[]> {
    // Query tasks by session ID
    // Apply filters
    // Return sorted results
  }

  async getTaskById(taskId: string): Promise<Task | null> {
    // Load task from database
    // Verify task belongs to this session
    // Return task with notes
  }

  async updateTask(taskId: string, updates: Partial<Task>, context: TaskContext): Promise<Task> {
    // Load existing task
    // Verify permissions and session ownership
    // Apply updates
    // Save to database
    // Return updated task
  }

  async addNote(taskId: string, content: string, context: TaskContext): Promise<TaskNote> {
    // Create note
    // Save to database
    // Update task timestamp
    // Return note
  }

  async deleteTask(taskId: string, context: TaskContext): Promise<void> {
    // Verify permissions and session ownership
    // Delete from database
  }

  async getTaskSummary(): Promise<TaskSummary> {
    // Count tasks by status for this session
    // Return summary object
  }
}
```

2. **Write tests first** (`src/tasks/__tests__/task-manager.test.ts`):

**TDD Step 1: Write failing tests**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskManager } from '../task-manager.js';
import { DatabasePersistence } from '../../persistence/database.js';
import { createTempDatabase } from '../../__tests__/test-utils.js';

describe('TaskManager', () => {
  let manager: TaskManager;
  let persistence: DatabasePersistence;
  let cleanup: () => void;

  beforeEach(async () => {
    const { persistence: p, cleanup: c } = await createTempDatabase();
    persistence = p;
    manager = new TaskManager(persistence);
    cleanup = c;
  });

  afterEach(() => {
    cleanup();
  });

  describe('createTask', () => {
    it('should create task with required fields', async () => {
      const request = {
        title: 'Test Task',
        description: 'Test description',
        prompt: 'Test prompt',
        priority: 'medium' as const
      };
      const context = { threadId: 'lace_20250714_abc123.1' };

      const task = await manager.createTask(request, context);

      expect(task.title).toBe('Test Task');
      expect(task.createdBy).toBe('lace_20250714_abc123.1');
      expect(task.threadId).toBe('lace_20250714_abc123');
      expect(task.id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
    });

    it('should validate required fields', async () => {
      const request = { title: '', description: '', prompt: '' };
      const context = { threadId: 'lace_20250714_abc123.1' };

      await expect(manager.createTask(request, context)).rejects.toThrow();
    });
  });

  describe('getTasksForSession', () => {
    it('should return tasks for session', async () => {
      // Create test tasks
      // Query by session
      // Verify results
    });

    it('should filter by status', async () => {
      // Create tasks with different statuses
      // Query with status filter
      // Verify filtering
    });
  });

  // More test cases...
});
```

**TDD Step 2: Verify tests fail**
```bash
npm test src/tasks/__tests__/task-manager.test.ts
# Should fail because TaskManager doesn't exist yet
```

3. **Implement TaskManager** following TDD:

**TDD Step 3: Implement minimal code to pass tests**
```typescript
// src/tasks/task-manager.ts
export class TaskManager {
  constructor(private persistence: DatabasePersistence) {}

  async createTask(request: CreateTaskRequest, context: TaskContext): Promise<Task> {
    // Implement ONLY enough to make tests pass
    // Don't add extra features not covered by tests
  }

  async getTasksForSession(sessionId: string, filters?: TaskFilters): Promise<Task[]> {
    // Implement based on test requirements
  }
}
```

**TDD Step 4: Verify tests pass**
```bash
npm test src/tasks/__tests__/task-manager.test.ts
# Should pass now
```

**TDD Step 5: Lint and type check**
```bash
npm run lint
npm run build
# Fix any issues before proceeding
```

3. **Update tools to use session's TaskManager** (`src/tools/implementations/task-manager/tools.ts`):
```typescript
import { TaskManager } from '../../../tasks/task-manager.js';

export class TaskCreateTool extends Tool {
  constructor(private getTaskManager: () => TaskManager) {
    super();
  }

  protected async executeValidated(args: CreateTaskArgs, context?: ToolContext): Promise<ToolResult> {
    const taskManager = this.getTaskManager();
    const taskContext = {
      actor: context?.threadId || 'unknown',
      isHuman: false
    };

    const task = await taskManager.createTask(args, taskContext);
    return this.createResult(`Task created: ${task.title} (${task.id})`);
  }
}
```

**Testing**:
```bash
# Run tests
npm test src/services/__tests__/task-service.test.ts

# Run tool tests to ensure no regression
npm test src/tools/implementations/task-manager/__tests__/tools.test.ts
```

**BEFORE COMMITTING: Complete TDD Checklist above**

**Commit**: `feat: extract TaskService from agent tools`

### Task 1.2: Add Service to Dependency Injection

**Objective**: Make TaskService available throughout the application

**Files to Modify**:
- `src/services/index.ts` - Export TaskService
- `src/tools/implementations/task-manager/index.ts` - Use injected service
- `src/interfaces/web/lib/server/session-service.ts` - Add task service

**Implementation**:

1. **Export from services** (`src/services/index.ts`):
```typescript
export { TaskService } from './task-service.js';
export type { ServiceContext } from './task-service.js';
```

2. **Update tool registration** (`src/tools/implementations/task-manager/index.ts`):
```typescript
import { TaskService } from '../../../services/task-service.js';

export function createTaskManagerTools(taskService: TaskService): Tool[] {
  return [
    new TaskCreateTool(taskService),
    new TaskListTool(taskService),
    new TaskCompleteTool(taskService),
    new TaskUpdateTool(taskService),
    new TaskAddNoteTool(taskService),
    new TaskViewTool(taskService),
  ];
}
```

3. **Update SessionService** (`packages/web/lib/server/session-service.ts`):
```typescript
import { TaskManager } from '../../../../src/tasks/task-manager.js';

export class SessionService {
  private taskManager: TaskManager;

  constructor(
    private persistence: DatabasePersistence,
    private providerRegistry: ProviderRegistry
  ) {
    this.taskManager = new TaskManager(sessionId, persistence);
  }

  getTaskManager(): TaskManager {
    return this.taskManager;
  }
}
```

**Testing**:
```bash
# Test tool integration
npm test src/tools/implementations/task-manager/__tests__/

# Test web service integration
npm test packages/web/lib/server/__tests__/session-service.test.ts
```

**Commit**: `feat: add TaskService to dependency injection`

## Phase 2: Web API Endpoints

**Status**: ✅ COMPLETED

### Task 2.1: Task Management API Routes

**Status**: ✅ COMPLETED

**Objective**: Create REST endpoints for task CRUD operations

**Files to Create**:
- `packages/web/app/api/tasks/route.ts` - List/Create tasks
- `packages/web/app/api/tasks/[taskId]/route.ts` - Get/Update/Delete task
- `packages/web/app/api/tasks/[taskId]/notes/route.ts` - Add notes
- `packages/web/app/api/tasks/__tests__/route.test.ts` - API tests

**Implementation**:

1. **Write API tests first** (`packages/web/app/api/tasks/__tests__/route.test.ts`):

**TDD Step 1: Write failing tests**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route.js';
import { createMockSessionService } from '../../../__tests__/test-utils.js';

describe('Task API', () => {
  let mockSessionService: any;
  let cleanup: () => void;

  beforeEach(async () => {
    const { sessionService, cleanup: c } = await createMockSessionService();
    mockSessionService = sessionService;
    cleanup = c;
  });

  afterEach(() => {
    cleanup();
  });

  describe('GET /api/tasks', () => {
    it('should list tasks with filters', async () => {
      // Create test tasks
      // Make request with filters
      // Verify response format
    });

    it('should require session context', async () => {
      const request = new NextRequest('http://localhost/api/tasks');
      const response = await GET(request);
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/tasks', () => {
    it('should create task', async () => {
      const request = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Task',
          description: 'Test description',
          prompt: 'Test prompt',
          priority: 'medium'
        })
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
      
      const task = await response.json();
      expect(task.title).toBe('Test Task');
    });

    it('should validate required fields', async () => {
      const request = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });
  });
});
```

**TDD Step 2: Verify tests fail**
```bash
npm test packages/web/app/api/tasks/__tests__/route.test.ts
# Should fail - route doesn't exist yet
```

2. **Implement API routes** (`packages/web/app/api/tasks/route.ts`):

**TDD Step 3: Implement minimal code to pass tests**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  assignedTo: z.string().optional(),
  sessionId: z.string()
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const sessionService = getSessionService();
    const taskManager = sessionService.getTaskManager(sessionId);

    const tasks = await taskManager.getTasks({
      status: status as any,
      assignedTo
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('Failed to list tasks:', error);
    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = CreateTaskSchema.parse(body);

    const sessionService = getSessionService();
    const taskManager = sessionService.getTaskManager(data.sessionId);

    const task = await taskManager.createTask(data, {
      actor: `${data.sessionId}:human`,
      isHuman: true
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error('Failed to create task:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
```

**TDD Step 4: Verify tests pass**
```bash
npm test packages/web/app/api/tasks/__tests__/route.test.ts
# Should pass now
```

**TDD Step 5: Lint and type check**
```bash
npm run lint
npm run build
# Fix any issues before proceeding
```

3. **Implement task detail routes** (`packages/web/app/api/tasks/[taskId]/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const sessionService = getSessionService();
    const taskService = sessionService.getTaskService();

    const task = await taskService.getTaskById(params.taskId, { isHuman: true });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error('Failed to get task:', error);
    return NextResponse.json({ error: 'Failed to get task' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const updates = await request.json();
    
    const sessionService = getSessionService();
    const taskService = sessionService.getTaskService();

    const task = await taskService.updateTask(params.taskId, updates, { isHuman: true });

    return NextResponse.json(task);
  } catch (error) {
    console.error('Failed to update task:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const sessionService = getSessionService();
    const taskService = sessionService.getTaskService();

    await taskService.deleteTask(params.taskId, { isHuman: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete task:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
```

**Testing**:
```bash
# Test API routes
npm test packages/web/app/api/tasks/__tests__/

# Test with curl
curl -X GET "http://localhost:3000/api/tasks?sessionId=lace_20250714_abc123"
curl -X POST "http://localhost:3000/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","prompt":"Test","sessionId":"lace_20250714_abc123"}'
```

**BEFORE COMMITTING: Complete TDD Checklist above**

**Commit**: `feat: add task management API endpoints`

### Task 2.2: Session-Scoped Task API

**Objective**: Add convenience endpoints for session-specific task operations

**Files to Create**:
- `packages/web/app/api/sessions/[sessionId]/tasks/route.ts` - Session tasks
- `packages/web/app/api/sessions/[sessionId]/tasks/summary/route.ts` - Task summary
- `packages/web/app/api/sessions/[sessionId]/tasks/__tests__/route.test.ts` - Tests

**Implementation**:

1. **Session tasks endpoint** (`packages/web/app/api/sessions/[sessionId]/tasks/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');

    const sessionService = getSessionService();
    const taskService = sessionService.getTaskService();

    const tasks = await taskService.getTasksForSession(params.sessionId, {
      status: status as any,
      assignedTo
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('Failed to get session tasks:', error);
    return NextResponse.json({ error: 'Failed to get session tasks' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const body = await request.json();
    
    const sessionService = getSessionService();
    const taskService = sessionService.getTaskService();

    const task = await taskService.createTask(body, {
      threadId: params.sessionId,
      parentThreadId: params.sessionId,
      isHuman: true
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error('Failed to create session task:', error);
    return NextResponse.json({ error: 'Failed to create session task' }, { status: 500 });
  }
}
```

2. **Task summary endpoint** (`packages/web/app/api/sessions/[sessionId]/tasks/summary/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionService = getSessionService();
    const taskService = sessionService.getTaskService();

    const summary = await taskService.getTaskSummary(params.sessionId);

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Failed to get task summary:', error);
    return NextResponse.json({ error: 'Failed to get task summary' }, { status: 500 });
  }
}
```

**Testing**:
```bash
# Test session-specific endpoints
npm test packages/web/app/api/sessions/__tests__/

# Manual testing
curl -X GET "http://localhost:3000/api/sessions/lace_20250714_abc123/tasks"
curl -X GET "http://localhost:3000/api/sessions/lace_20250714_abc123/tasks/summary"
```

**Commit**: `feat: add session-scoped task API endpoints`

## Phase 3: React Hooks and Client Library (COMPLETED)

## Status Update
- Phase 1: COMPLETED ✅
- Phase 2: COMPLETED ✅ 
- Phase 3: COMPLETED ✅
- Phase 4: READY TO START
- Phase 5: TODO

All tests passing (1961/1966), TypeScript compilation clean, linting clean.

This phase focuses on creating the client-side infrastructure that will power the UI components.

### Task 3.1: Create Task API Client (Status: Complete ✅)

**Objective**: Create client-side API for task management operations

**Files Created**:
- `packages/web/lib/client/task-api.ts` - API client
- `packages/web/lib/client/__tests__/task-api.test.ts` - API client tests

### Task 3.2: Task Manager Hook (Status: Complete ✅)

**Objective**: Create React hook for task management operations

**Files Created**:
- `packages/web/hooks/useTaskManager.ts` - Main hook
- `packages/web/hooks/__tests__/useTaskManager.test.tsx` - Hook tests

**Implementation**:

1. **API client** (`packages/web/lib/client/task-api.ts`):
```typescript
import { Task, TaskNote, CreateTaskRequest, TaskFilters } from '../types/tasks.js';

export class TaskAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async listTasks(sessionId: string, filters?: TaskFilters): Promise<Task[]> {
    const params = new URLSearchParams({ sessionId });
    if (filters?.status) params.append('status', filters.status);
    if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);

    const response = await fetch(`${this.baseUrl}/api/tasks?${params}`);
    if (!response.ok) {
      throw new Error('Failed to fetch tasks');
    }

    const data = await response.json();
    return data.tasks;
  }

  async createTask(sessionId: string, task: CreateTaskRequest): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...task, sessionId })
    });

    if (!response.ok) {
      throw new Error('Failed to create task');
    }

    return response.json();
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      throw new Error('Failed to update task');
    }

    return response.json();
  }

  async deleteTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete task');
    }
  }

  async addNote(taskId: string, content: string): Promise<TaskNote> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      throw new Error('Failed to add note');
    }

    return response.json();
  }

  async getTaskSummary(sessionId: string): Promise<TaskSummary> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/tasks/summary`);
    if (!response.ok) {
      throw new Error('Failed to get task summary');
    }

    return response.json();
  }
}
```

2. **Write hook tests** (`packages/web/hooks/__tests__/useTaskManager.test.ts`):
```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTaskManager } from '../useTaskManager.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useTaskManager', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should load tasks on mount', async () => {
    const mockTasks = [
      { id: 'task1', title: 'Test Task', status: 'pending' }
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tasks: mockTasks })
    });

    const { result } = renderHook(() => useTaskManager('session1'));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.tasks).toEqual(mockTasks);
  });

  it('should create task', async () => {
    const newTask = { id: 'task2', title: 'New Task', status: 'pending' };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newTask
      });

    const { result } = renderHook(() => useTaskManager('session1'));

    await act(async () => {
      await result.current.createTask({
        title: 'New Task',
        description: 'Test',
        prompt: 'Test prompt',
        priority: 'medium'
      });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Task',
        description: 'Test',
        prompt: 'Test prompt',
        priority: 'medium',
        sessionId: 'session1'
      })
    });
  });

  it('should handle errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useTaskManager('session1'));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Failed to fetch tasks');
  });
});
```

3. **Implement hook** (`packages/web/hooks/useTaskManager.ts`):
```typescript
import { useState, useEffect, useCallback } from 'react';
import { Task, TaskNote, CreateTaskRequest, TaskFilters, TaskSummary } from '../types/tasks.js';
import { TaskAPIClient } from '../lib/client/task-api.js';

export function useTaskManager(sessionId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TaskSummary | null>(null);

  const apiClient = new TaskAPIClient();

  const loadTasks = useCallback(async (filters?: TaskFilters) => {
    try {
      setLoading(true);
      setError(null);
      const newTasks = await apiClient.listTasks(sessionId, filters);
      setTasks(newTasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadSummary = useCallback(async () => {
    try {
      const newSummary = await apiClient.getTaskSummary(sessionId);
      setSummary(newSummary);
    } catch (err) {
      console.error('Failed to load task summary:', err);
    }
  }, [sessionId]);

  const createTask = useCallback(async (task: CreateTaskRequest) => {
    try {
      const newTask = await apiClient.createTask(sessionId, task);
      setTasks(prev => [...prev, newTask]);
      await loadSummary();
      return newTask;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      throw err;
    }
  }, [sessionId, loadSummary]);

  const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
    try {
      const updatedTask = await apiClient.updateTask(taskId, updates);
      setTasks(prev => prev.map(task => 
        task.id === taskId ? updatedTask : task
      ));
      await loadSummary();
      return updatedTask;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
      throw err;
    }
  }, [loadSummary]);

  const deleteTask = useCallback(async (taskId: string) => {
    try {
      await apiClient.deleteTask(taskId);
      setTasks(prev => prev.filter(task => task.id !== taskId));
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
      throw err;
    }
  }, [loadSummary]);

  const addNote = useCallback(async (taskId: string, content: string) => {
    try {
      const note = await apiClient.addNote(taskId, content);
      setTasks(prev => prev.map(task => 
        task.id === taskId 
          ? { ...task, notes: [...task.notes, note] }
          : task
      ));
      return note;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note');
      throw err;
    }
  }, []);

  // Load initial data
  useEffect(() => {
    loadTasks();
    loadSummary();
  }, [loadTasks, loadSummary]);

  return {
    tasks,
    summary,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    addNote,
    refreshTasks: loadTasks,
    refreshSummary: loadSummary
  };
}
```

**Testing**:
```bash
# Test hook
npm test packages/web/hooks/__tests__/useTaskManager.test.ts

# Test API client
npm test packages/web/lib/client/__tests__/task-api.test.ts
```

**Commit**: `feat: add task manager React hook and API client`

### Task 3.2: Real-time Updates with SSE

**Objective**: Integrate task updates with existing SSE system

**Files to Modify**:
- `packages/web/lib/sse-manager.ts` - Add task events
- `packages/web/hooks/useTaskManager.ts` - Subscribe to events
- `packages/web/hooks/useSSEStream.ts` - Handle task events

**Implementation**:

1. **Add task events to SSE** (`packages/web/lib/sse-manager.ts`):
```typescript
export interface TaskEvent {
  type: 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_DELETED' | 'TASK_NOTE_ADDED';
  taskId: string;
  task?: Task;
  note?: TaskNote;
  timestamp: string;
}

export class SSEManager {
  // ... existing code ...

  broadcastTaskEvent(sessionId: string, event: TaskEvent): void {
    const eventData = {
      type: 'task_event',
      data: event
    };

    this.broadcast(sessionId, eventData);
  }
}
```

2. **Update TaskService to emit events** (`src/services/task-service.ts`):
```typescript
import { SSEManager } from '../interfaces/web/lib/sse-manager.js';

export class TaskService {
  constructor(
    private persistence: DatabasePersistence,
    private sseManager?: SSEManager
  ) {}

  async createTask(request: CreateTaskRequest, context: ServiceContext): Promise<Task> {
    // ... existing creation logic ...

    // Emit SSE event
    if (this.sseManager) {
      this.sseManager.broadcastTaskEvent(task.threadId, {
        type: 'TASK_CREATED',
        taskId: task.id,
        task,
        timestamp: new Date().toISOString()
      });
    }

    return task;
  }

  async updateTask(taskId: string, updates: Partial<Task>, context: ServiceContext): Promise<Task> {
    // ... existing update logic ...

    // Emit SSE event
    if (this.sseManager) {
      this.sseManager.broadcastTaskEvent(task.threadId, {
        type: 'TASK_UPDATED',
        taskId: task.id,
        task,
        timestamp: new Date().toISOString()
      });
    }

    return task;
  }
}
```

3. **Update hook to handle SSE events** (`packages/web/hooks/useTaskManager.ts`):
```typescript
import { useSSEStream } from './useSSEStream.js';

export function useTaskManager(sessionId: string) {
  // ... existing state ...

  // Subscribe to real-time updates
  useSSEStream(sessionId, {
    onEvent: (event) => {
      if (event.type === 'task_event') {
        const taskEvent = event.data as TaskEvent;
        
        switch (taskEvent.type) {
          case 'TASK_CREATED':
            if (taskEvent.task) {
              setTasks(prev => [...prev, taskEvent.task]);
            }
            break;
            
          case 'TASK_UPDATED':
            if (taskEvent.task) {
              setTasks(prev => prev.map(task => 
                task.id === taskEvent.taskId ? taskEvent.task : task
              ));
            }
            break;
            
          case 'TASK_DELETED':
            setTasks(prev => prev.filter(task => task.id !== taskEvent.taskId));
            break;
            
          case 'TASK_NOTE_ADDED':
            if (taskEvent.note) {
              setTasks(prev => prev.map(task => 
                task.id === taskEvent.taskId 
                  ? { ...task, notes: [...task.notes, taskEvent.note] }
                  : task
              ));
            }
            break;
        }
        
        // Refresh summary on any task change
        loadSummary();
      }
    }
  });

  // ... rest of hook implementation ...
}
```

**Testing**:
```bash
# Test SSE integration
npm test packages/web/hooks/__tests__/useTaskManager.test.ts

# Test real-time updates manually
# Open two browser tabs, modify task in one, verify update in other
```

**Commit**: `feat: add real-time task updates via SSE`

## Phase 4: UI Components ✅ COMPLETED

### Task 4.1: Task List Component ✅

**Objective**: Create reusable task list component

**Files to Create**:
- `packages/web/components/TaskList.tsx` - Main component
- `packages/web/components/TaskListItem.tsx` - Individual task item
- `packages/web/components/__tests__/TaskList.test.tsx` - Component tests

**Implementation**:

1. **Write component tests first** (`packages/web/components/__tests__/TaskList.test.tsx`):

**TDD Step 1: Write failing tests**
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskList } from '../TaskList.js';

const mockTasks = [
  {
    id: 'task1',
    title: 'Complete feature',
    description: 'Implement new feature',
    prompt: 'Implement X feature with Y requirements',
    status: 'pending' as const,
    priority: 'high' as const,
    assignedTo: 'lace_20250714_abc123.1',
    createdBy: 'lace_20250714_abc123.1',
    threadId: 'lace_20250714_abc123',
    createdAt: new Date('2025-01-14T10:00:00Z'),
    updatedAt: new Date('2025-01-14T10:00:00Z'),
    notes: []
  }
];

describe('TaskList', () => {
  it('should render tasks', () => {
    render(<TaskList tasks={mockTasks} onTaskClick={vi.fn()} />);
    
    expect(screen.getByText('Complete feature')).toBeInTheDocument();
    expect(screen.getByText('Implement new feature')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
  });

  it('should handle task click', () => {
    const onTaskClick = vi.fn();
    render(<TaskList tasks={mockTasks} onTaskClick={onTaskClick} />);
    
    fireEvent.click(screen.getByText('Complete feature'));
    expect(onTaskClick).toHaveBeenCalledWith(mockTasks[0]);
  });

  it('should filter by status', () => {
    const allTasks = [
      ...mockTasks,
      { ...mockTasks[0], id: 'task2', status: 'completed' as const }
    ];
    
    render(<TaskList tasks={allTasks} statusFilter="pending" onTaskClick={vi.fn()} />);
    
    expect(screen.getByText('Complete feature')).toBeInTheDocument();
    expect(screen.queryByText('task2')).not.toBeInTheDocument();
  });

  it('should show empty state', () => {
    render(<TaskList tasks={[]} onTaskClick={vi.fn()} />);
    
    expect(screen.getByText('No tasks found')).toBeInTheDocument();
  });
});
```

2. **Implement TaskListItem** (`packages/web/components/TaskListItem.tsx`):
```typescript
import { Task } from '../types/tasks.js';

interface TaskListItemProps {
  task: Task;
  onClick: (task: Task) => void;
  onStatusChange?: (taskId: string, status: Task['status']) => void;
}

export function TaskListItem({ task, onClick, onStatusChange }: TaskListItemProps) {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString();
  };

  const formatAssignee = (assignedTo?: string) => {
    if (!assignedTo) return 'Unassigned';
    if (assignedTo.startsWith('new:')) return assignedTo;
    return assignedTo.split('.').pop() || assignedTo;
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'low': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'in_progress': return '🔄';
      case 'completed': return '✅';
      case 'blocked': return '🚫';
      default: return '❓';
    }
  };

  return (
    <div
      className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={() => onClick(task)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{getStatusIcon(task.status)}</span>
            <h3 className="font-medium text-gray-900">{task.title}</h3>
            <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(task.priority)}`}>
              {task.priority.toUpperCase()}
            </span>
          </div>
          
          {task.description && (
            <p className="text-sm text-gray-600 mb-2">{task.description}</p>
          )}
          
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>Assigned to: {formatAssignee(task.assignedTo)}</span>
            <span>Created: {formatDate(task.createdAt)}</span>
            {task.notes.length > 0 && (
              <span>{task.notes.length} notes</span>
            )}
          </div>
        </div>
        
        {onStatusChange && (
          <select
            value={task.status}
            onChange={(e) => {
              e.stopPropagation();
              onStatusChange(task.id, e.target.value as Task['status']);
            }}
            className="ml-4 px-2 py-1 border rounded text-sm"
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="blocked">Blocked</option>
          </select>
        )}
      </div>
    </div>
  );
}
```

3. **Implement TaskList** (`packages/web/components/TaskList.tsx`):
```typescript
import { Task } from '../types/tasks.js';
import { TaskListItem } from './TaskListItem.js';

interface TaskListProps {
  tasks: Task[];
  statusFilter?: Task['status'];
  assigneeFilter?: string;
  onTaskClick: (task: Task) => void;
  onStatusChange?: (taskId: string, status: Task['status']) => void;
  loading?: boolean;
  error?: string;
}

export function TaskList({
  tasks,
  statusFilter,
  assigneeFilter,
  onTaskClick,
  onStatusChange,
  loading,
  error
}: TaskListProps) {
  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    if (statusFilter && task.status !== statusFilter) return false;
    if (assigneeFilter && task.assignedTo !== assigneeFilter) return false;
    return true;
  });

  // Sort tasks by priority and creation date
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-600">Error: {error}</p>
      </div>
    );
  }

  if (sortedTasks.length === 0) {
    return (
      <div className="text-center p-8 text-gray-500">
        <p>No tasks found</p>
        {(statusFilter || assigneeFilter) && (
          <p className="text-sm mt-2">Try adjusting your filters</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedTasks.map(task => (
        <TaskListItem
          key={task.id}
          task={task}
          onClick={onTaskClick}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
}
```

**Testing**:
```bash
# Test components
npm test packages/web/components/__tests__/TaskList.test.tsx

# Test in browser
npm run web:dev
# Navigate to task list page
```

**Commit**: `feat: add TaskList and TaskListItem components`

### Task 4.2: Task Detail Modal ✅

**Objective**: Create modal for viewing and editing task details

**Files to Create**:
- `packages/web/components/TaskDetailModal.tsx` - Modal component
- `packages/web/components/TaskNotes.tsx` - Notes section
- `packages/web/components/__tests__/TaskDetailModal.test.tsx` - Tests

**Implementation**:

1. **Task Notes Component** (`packages/web/components/TaskNotes.tsx`):
```typescript
import { useState } from 'react';
import { TaskNote } from '../types/tasks.js';

interface TaskNotesProps {
  notes: TaskNote[];
  onAddNote: (content: string) => Promise<void>;
  loading?: boolean;
}

export function TaskNotes({ notes, onAddNote, loading }: TaskNotesProps) {
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setSubmitting(true);
    try {
      await onAddNote(newNote.trim());
      setNewNote('');
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const formatAuthor = (author: string) => {
    if (author.startsWith('lace_')) {
      return author.split('.').pop() || author;
    }
    return author;
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-gray-900">Notes</h3>
      
      {/* Notes list */}
      <div className="space-y-3 max-h-60 overflow-y-auto">
        {notes.length === 0 ? (
          <p className="text-gray-500 text-sm">No notes yet</p>
        ) : (
          notes.map(note => (
            <div key={note.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">
                  {formatAuthor(note.author)}
                </span>
                <span className="text-xs text-gray-500">
                  {formatTimestamp(note.timestamp)}
                </span>
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">
                {note.content}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Add note form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          disabled={submitting}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !newNote.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {submitting ? 'Adding...' : 'Add Note'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

2. **Task Detail Modal** (`packages/web/components/TaskDetailModal.tsx`):
```typescript
import { useState } from 'react';
import { Task } from '../types/tasks.js';
import { TaskNotes } from './TaskNotes.js';

interface TaskDetailModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onAddNote: (taskId: string, content: string) => Promise<void>;
  onDelete?: (taskId: string) => Promise<void>;
}

export function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onUpdate,
  onAddNote,
  onDelete
}: TaskDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    priority: task.priority,
    assignedTo: task.assignedTo || '',
    status: task.status
  });
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(task.id, {
        title: editForm.title,
        description: editForm.description,
        prompt: editForm.prompt,
        priority: editForm.priority,
        assignedTo: editForm.assignedTo || undefined,
        status: editForm.status
      });
      setEditing(false);
    } catch (error) {
      console.error('Failed to update task:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditForm({
      title: task.title,
      description: task.description,
      prompt: task.prompt,
      priority: task.priority,
      assignedTo: task.assignedTo || '',
      status: task.status
    });
    setEditing(false);
  };

  const handleAddNote = async (content: string) => {
    await onAddNote(task.id, content);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              {editing ? 'Edit Task' : 'Task Details'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <span className="sr-only">Close</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Task details */}
          <div className="space-y-6">
            {editing ? (
              /* Edit form */
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Prompt (Agent Instructions)
                  </label>
                  <textarea
                    value={editForm.prompt}
                    onChange={(e) => setEditForm(prev => ({ ...prev, prompt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Priority
                    </label>
                    <select
                      value={editForm.priority}
                      onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Status
                    </label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value as Task['status'] }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Assigned To
                  </label>
                  <input
                    type="text"
                    value={editForm.assignedTo}
                    onChange={(e) => setEditForm(prev => ({ ...prev, assignedTo: e.target.value }))}
                    placeholder="Thread ID or new:provider/model"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{task.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      task.priority === 'high' ? 'text-red-600 bg-red-50' :
                      task.priority === 'medium' ? 'text-yellow-600 bg-yellow-50' :
                      'text-green-600 bg-green-50'
                    }`}>
                      {task.priority.toUpperCase()}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      task.status === 'completed' ? 'text-green-600 bg-green-50' :
                      task.status === 'in_progress' ? 'text-blue-600 bg-blue-50' :
                      task.status === 'blocked' ? 'text-red-600 bg-red-50' :
                      'text-gray-600 bg-gray-50'
                    }`}>
                      {task.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {task.description && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Description</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Agent Instructions</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                    {task.prompt}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Assigned to:</span>
                    <span className="ml-2 text-gray-600">
                      {task.assignedTo || 'Unassigned'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Created:</span>
                    <span className="ml-2 text-gray-600">
                      {new Date(task.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Notes section */}
            <div className="border-t pt-6">
              <TaskNotes
                notes={task.notes}
                onAddNote={handleAddNote}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center mt-6 pt-6 border-t">
            <div>
              {onDelete && (
                <button
                  onClick={() => onDelete(task.id)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Delete Task
                </button>
              )}
            </div>
            
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 text-gray-600 hover:text-gray-700"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Testing**:
```bash
# Test modal components
npm test packages/web/components/__tests__/TaskDetailModal.test.tsx

# Test interactively
npm run web:dev
# Click on tasks to open modal
```

**Commit**: `feat: add TaskDetailModal and TaskNotes components`

### Task 4.3: Task Dashboard ✅

**Objective**: Create main dashboard component for task management

**Files to Create**:
- `packages/web/components/TaskDashboard.tsx` - Main dashboard
- `packages/web/components/TaskSummary.tsx` - Summary widget
- `packages/web/components/TaskFilters.tsx` - Filtering controls
- `packages/web/components/__tests__/TaskDashboard.test.tsx` - Tests

**Implementation**:

1. **Task Summary Widget** (`packages/web/components/TaskSummary.tsx`):
```typescript
import { TaskSummary as TaskSummaryType } from '../types/tasks.js';

interface TaskSummaryProps {
  summary: TaskSummaryType | null;
  loading?: boolean;
}

export function TaskSummary({ summary, loading }: TaskSummaryProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <p className="text-gray-500">No task summary available</p>
      </div>
    );
  }

  const statusCounts = [
    { label: 'Pending', count: summary.pending, color: 'text-gray-600 bg-gray-50' },
    { label: 'In Progress', count: summary.in_progress, color: 'text-blue-600 bg-blue-50' },
    { label: 'Completed', count: summary.completed, color: 'text-green-600 bg-green-50' },
    { label: 'Blocked', count: summary.blocked, color: 'text-red-600 bg-red-50' }
  ];

  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Task Summary</h3>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statusCounts.map(({ label, count, color }) => (
          <div key={label} className={`p-3 rounded-lg ${color}`}>
            <div className="text-2xl font-bold">{count}</div>
            <div className="text-sm">{label}</div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 text-sm text-gray-500">
        Total: {summary.total} tasks
      </div>
    </div>
  );
}
```

2. **Task Filters** (`packages/web/components/TaskFilters.tsx`):
```typescript
import { Task } from '../types/tasks.js';

interface TaskFiltersProps {
  statusFilter: Task['status'] | 'all';
  priorityFilter: Task['priority'] | 'all';
  assigneeFilter: string;
  onStatusChange: (status: Task['status'] | 'all') => void;
  onPriorityChange: (priority: Task['priority'] | 'all') => void;
  onAssigneeChange: (assignee: string) => void;
  onClearFilters: () => void;
}

export function TaskFilters({
  statusFilter,
  priorityFilter,
  assigneeFilter,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onClearFilters
}: TaskFiltersProps) {
  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || assigneeFilter;

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value as Task['status'] | 'all')}
            className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Priority:</label>
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityChange(e.target.value as Task['priority'] | 'all')}
            className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Assignee:</label>
          <input
            type="text"
            value={assigneeFilter}
            onChange={(e) => onAssigneeChange(e.target.value)}
            placeholder="Thread ID or agent name"
            className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {hasFilters && (
          <button
            onClick={onClearFilters}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}
```

3. **Task Dashboard** (`packages/web/components/TaskDashboard.tsx`):
```typescript
import { useState } from 'react';
import { Task } from '../types/tasks.js';
import { useTaskManager } from '../hooks/useTaskManager.js';
import { TaskSummary } from './TaskSummary.js';
import { TaskFilters } from './TaskFilters.js';
import { TaskList } from './TaskList.js';
import { TaskDetailModal } from './TaskDetailModal.js';
import { CreateTaskModal } from './CreateTaskModal.js';

interface TaskDashboardProps {
  sessionId: string;
}

export function TaskDashboard({ sessionId }: TaskDashboardProps) {
  const {
    tasks,
    summary,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    addNote
  } = useTaskManager(sessionId);

  const [statusFilter, setStatusFilter] = useState<Task['status'] | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Task['priority'] | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Filter tasks based on current filters
  const filteredTasks = tasks.filter(task => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (assigneeFilter && !task.assignedTo?.includes(assigneeFilter)) return false;
    return true;
  });

  const handleClearFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setAssigneeFilter('');
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
  };

  const handleStatusChange = async (taskId: string, status: Task['status']) => {
    try {
      await updateTask(taskId, { status });
    } catch (error) {
      console.error('Failed to update task status:', error);
    }
  };

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    await updateTask(taskId, updates);
    // Update selected task if it's the one being edited
    if (selectedTask?.id === taskId) {
      setSelectedTask(prev => prev ? { ...prev, ...updates } : null);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    await deleteTask(taskId);
    setSelectedTask(null);
  };

  const handleAddNote = async (taskId: string, content: string) => {
    await addNote(taskId, content);
    // Refresh selected task to show new note
    if (selectedTask?.id === taskId) {
      const updatedTask = tasks.find(t => t.id === taskId);
      if (updatedTask) {
        setSelectedTask(updatedTask);
      }
    }
  };

  const handleCreateTask = async (taskData: any) => {
    try {
      await createTask(taskData);
      setShowCreateModal(false);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Task Management</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Create Task
        </button>
      </div>

      {/* Summary */}
      <TaskSummary summary={summary} loading={loading} />

      {/* Filters */}
      <TaskFilters
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        assigneeFilter={assigneeFilter}
        onStatusChange={setStatusFilter}
        onPriorityChange={setPriorityFilter}
        onAssigneeChange={setAssigneeFilter}
        onClearFilters={handleClearFilters}
      />

      {/* Task List */}
      <div className="bg-white rounded-lg border p-4">
        <TaskList
          tasks={filteredTasks}
          onTaskClick={handleTaskClick}
          onStatusChange={handleStatusChange}
          loading={loading}
          error={error}
        />
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
          onAddNote={handleAddNote}
          onDelete={handleTaskDelete}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTask}
        />
      )}
    </div>
  );
}
```

**Testing**:
```bash
# Test dashboard
npm test packages/web/components/__tests__/TaskDashboard.test.tsx

# Test in browser
npm run web:dev
```

**Commit**: `feat: add TaskDashboard with summary and filtering`

## Phase 5: Integration with Web UI

### Task 5.1: Add Task Dashboard to Main Page

**Objective**: Integrate task dashboard into existing web UI

**Files to Modify**:
- `packages/web/app/page.tsx` - Add task dashboard tab
- `packages/web/components/SessionDisplay.tsx` - Add task tab (if exists)

**Implementation**:

1. **Update main page** (`packages/web/app/page.tsx`):
```typescript
import { useState } from 'react';
import { TaskDashboard } from './components/TaskDashboard.js';
// ... other imports

export default function Home() {
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'conversation' | 'tasks'>('conversation');

  // ... existing session logic ...

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Session Selection */}
        <div className="mb-8">
          {/* ... existing session management ... */}
        </div>

        {/* Main Content */}
        {currentSession && (
          <div className="space-y-6">
            {/* Tab Navigation */}
            <div className="bg-white rounded-lg border">
              <div className="border-b">
                <nav className="flex space-x-8 px-6">
                  <button
                    onClick={() => setActiveTab('conversation')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'conversation'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Conversation
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'tasks'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Tasks
                  </button>
                </nav>
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {activeTab === 'conversation' && (
                  <div>
                    {/* ... existing conversation UI ... */}
                  </div>
                )}
                
                {activeTab === 'tasks' && (
                  <TaskDashboard sessionId={currentSession} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

2. **Add task notification in conversation** (optional enhancement):
```typescript
// In conversation display, show task-related events
const formatTaskEvent = (event: any) => {
  if (event.type === 'task_event') {
    const taskEvent = event.data;
    switch (taskEvent.type) {
      case 'TASK_CREATED':
        return `📋 Created task: ${taskEvent.task?.title}`;
      case 'TASK_UPDATED':
        return `📝 Updated task: ${taskEvent.task?.title}`;
      case 'TASK_COMPLETED':
        return `✅ Completed task: ${taskEvent.task?.title}`;
      default:
        return `📋 Task event: ${taskEvent.type}`;
    }
  }
  return null;
};
```

**Testing**:
```bash
# Test integration
npm run web:dev
# Create session, switch to tasks tab, test functionality

# Test tab switching
# Test task creation from web UI
# Test real-time updates
```

**Commit**: `feat: integrate task dashboard into main web UI`

### Task 5.2: Update Type Definitions

**Objective**: Ensure all TypeScript types are properly defined

**Files to Create/Modify**:
- `packages/web/types/tasks.ts` - Task type definitions
- `packages/web/types/api.ts` - API type definitions

**Implementation**:

1. **Task types** (`packages/web/types/tasks.ts`):
```typescript
// Re-export types from core, add web-specific types
export type { Task, TaskNote, CreateTaskRequest, TaskFilters } from '../../../../src/tools/implementations/task-manager/types.js';

export interface TaskSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

export interface TaskEvent {
  type: 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_DELETED' | 'TASK_NOTE_ADDED';
  taskId: string;
  task?: Task;
  note?: TaskNote;
  timestamp: string;
}

export interface TaskAPIResponse {
  tasks: Task[];
}

export interface TaskCreateResponse {
  success: boolean;
  task?: Task;
  error?: string;
}
```

2. **Update API types** (`packages/web/types/api.ts`):
```typescript
// Add to existing API types
export interface SessionEvent {
  // ... existing events ...
  type: 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT' | 'THINKING' | 'SYSTEM_MESSAGE' | 'task_event';
  data: any;
}
```

**Testing**:
```bash
# Test type compilation
npm run build

# Test type checking
npx tsc --noEmit
```

**Commit**: `feat: add comprehensive task management type definitions`

## Phase 6: Testing and Documentation

### Task 6.1: Integration Tests

**Objective**: Test complete task management workflow

**Files to Create**:
- `packages/web/__tests__/integration/task-management.test.ts` - Full workflow tests

**Implementation**:

1. **Integration tests** (`packages/web/__tests__/integration/task-management.test.ts`):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockSessionService } from '../test-utils.js';
import { TaskService } from '../../../../src/services/task-service.js';

describe('Task Management Integration', () => {
  let sessionService: any;
  let taskService: TaskService;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = await createMockSessionService();
    sessionService = setup.sessionService;
    taskService = sessionService.getTaskService();
    cleanup = setup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('should handle complete task lifecycle', async () => {
    const sessionId = 'lace_20250714_test123';
    const agentId = `${sessionId}.1`;

    // Create task
    const task = await taskService.createTask({
      title: 'Test Feature',
      description: 'Implement test feature',
      prompt: 'Please implement a test feature with proper error handling',
      priority: 'high',
      assignedTo: agentId
    }, {
      threadId: agentId,
      parentThreadId: sessionId,
      isHuman: false
    });

    expect(task.id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
    expect(task.status).toBe('pending');
    expect(task.assignedTo).toBe(agentId);

    // Update task status
    const updatedTask = await taskService.updateTask(task.id, {
      status: 'in_progress'
    }, {
      threadId: agentId,
      isHuman: false
    });

    expect(updatedTask.status).toBe('in_progress');

    // Add note
    const note = await taskService.addNote(task.id, 'Started working on this task', agentId, {
      threadId: agentId,
      isHuman: false
    });

    expect(note.author).toBe(agentId);
    expect(note.content).toBe('Started working on this task');

    // Complete task
    const completedTask = await taskService.updateTask(task.id, {
      status: 'completed'
    }, {
      threadId: agentId,
      isHuman: false
    });

    expect(completedTask.status).toBe('completed');

    // Verify task appears in session tasks
    const sessionTasks = await taskService.getTasksForSession(sessionId);
    expect(sessionTasks).toHaveLength(1);
    expect(sessionTasks[0].id).toBe(task.id);
  });

  it('should handle multi-agent task assignment', async () => {
    const sessionId = 'lace_20250714_test123';
    const agent1Id = `${sessionId}.1`;
    const agent2Id = `${sessionId}.2`;

    // Create task assigned to agent1
    const task = await taskService.createTask({
      title: 'Multi-agent Task',
      description: 'Task that gets reassigned',
      prompt: 'Work on this task',
      priority: 'medium',
      assignedTo: agent1Id
    }, {
      threadId: agent1Id,
      parentThreadId: sessionId,
      isHuman: false
    });

    // Reassign to agent2
    const reassignedTask = await taskService.updateTask(task.id, {
      assignedTo: agent2Id
    }, {
      threadId: agent1Id,
      isHuman: false
    });

    expect(reassignedTask.assignedTo).toBe(agent2Id);

    // Both agents should see the task
    const agent1Tasks = await taskService.getTasksForAgent(agent1Id);
    const agent2Tasks = await taskService.getTasksForAgent(agent2Id);
    
    expect(agent1Tasks).toHaveLength(0); // No longer assigned
    expect(agent2Tasks).toHaveLength(1); // Now assigned
  });

  it('should handle new agent specifications', async () => {
    const sessionId = 'lace_20250714_test123';
    const humanId = sessionId;

    // Create task with new agent spec
    const task = await taskService.createTask({
      title: 'New Agent Task',
      description: 'Task for new agent',
      prompt: 'Create new agent and work on this',
      priority: 'high',
      assignedTo: 'new:anthropic/claude-3-sonnet'
    }, {
      threadId: humanId,
      parentThreadId: sessionId,
      isHuman: true
    });

    expect(task.assignedTo).toBe('new:anthropic/claude-3-sonnet');
    expect(task.status).toBe('pending');

    // Simulate agent spawning (would be done by agent system)
    const spawnedAgentId = `${sessionId}.1`;
    const updatedTask = await taskService.updateTask(task.id, {
      assignedTo: spawnedAgentId
    }, {
      threadId: humanId,
      isHuman: true
    });

    expect(updatedTask.assignedTo).toBe(spawnedAgentId);
  });
});
```

**Testing**:
```bash
# Run integration tests
npm test packages/web/__tests__/integration/task-management.test.ts

# Run all tests
npm test packages/web
```

**Commit**: `test: add comprehensive task management integration tests`

### Task 6.2: Documentation

**Objective**: Document the task management system

**Files to Create**:
- `docs/features/task-management.md` - Feature documentation
- `packages/web/README.md` - Update with task management info

**Implementation**:

1. **Feature documentation** (`docs/features/task-management.md`):
```markdown
# Task Management System

## Overview

The task management system provides a human-visible interface for managing tasks across AI agents. It enables humans to create, assign, monitor, and coordinate tasks within a session.

## Features

- **Task CRUD Operations**: Create, read, update, delete tasks
- **Multi-agent Assignment**: Assign tasks to specific agents or request new agents
- **Real-time Updates**: Live updates via Server-Sent Events
- **Task Notes**: Communication channel between humans and agents
- **Task Filtering**: Filter by status, priority, assignee
- **Task Summary**: Overview of task distribution

## Architecture

### Core Components

1. **TaskManager** (`src/tasks/task-manager.ts`)
   - Session-scoped task management
   - Used by both agent tools and human API

2. **API Endpoints** (`packages/web/app/api/tasks/`)
   - REST endpoints for task management
   - Access TaskManager through session

3. **React Components** (`packages/web/components/`)
   - TaskDashboard: Main task management interface
   - TaskList: Task listing with filtering
   - TaskDetailModal: Task viewing/editing
   - TaskSummary: Task statistics

4. **React Hook** (`packages/web/hooks/useTaskManager.ts`)
   - Task management operations
   - Real-time updates via SSE
   - Error handling and loading states

### Data Flow

```
Human UI → API Endpoints → Session.getTaskManager() → TaskManager → Database
                                                         ↓
Agent Tools → Session.getTaskManager() → TaskManager → Database
                                                         ↓
SSE Events → React Components → UI Updates
```

## Usage

### Creating Tasks

```typescript
// Via API
POST /api/tasks
{
  "title": "Implement feature",
  "description": "Add new functionality",
  "prompt": "Detailed instructions for agent",
  "priority": "high",
  "assignedTo": "lace_20250714_abc123.1",
  "sessionId": "lace_20250714_abc123"
}

// Via React Hook
const { createTask } = useTaskManager(sessionId);
await createTask({
  title: "Implement feature",
  description: "Add new functionality",
  prompt: "Detailed instructions for agent",
  priority: "high"
});
```

### Agent Assignment

Tasks can be assigned to:
- **Existing agents**: Use full thread ID (e.g., `lace_20250714_abc123.1`)
- **New agents**: Use specification format (e.g., `new:anthropic/claude-3-sonnet`)

### Task States

- **pending**: Task created, not yet started
- **in_progress**: Agent is working on task
- **completed**: Task finished successfully
- **blocked**: Task cannot proceed

### Real-time Updates

The system broadcasts task events via SSE:
- `TASK_CREATED`: New task created
- `TASK_UPDATED`: Task properties changed
- `TASK_DELETED`: Task removed
- `TASK_NOTE_ADDED`: Note added to task

## Testing

### Unit Tests
```bash
# Test core service
npm test src/services/__tests__/task-service.test.ts

# Test API endpoints
npm test packages/web/app/api/tasks/__tests__/

# Test React components
npm test packages/web/components/__tests__/
```

### Integration Tests
```bash
# Test full workflow
npm test packages/web/__tests__/integration/task-management.test.ts
```

### Manual Testing
```bash
# Start web server
npm run web:dev

# Navigate to tasks tab
# Create, edit, assign tasks
# Verify real-time updates
```

## Configuration

No additional configuration required. The system uses:
- Existing SQLite database for persistence
- Existing SSE infrastructure for real-time updates
- Existing session management for scoping

## Future Enhancements

- Task dependencies and prerequisites
- Task templates for common workflows
- Bulk operations for multiple tasks
- Task search and full-text indexing
- Task analytics and reporting
- Task export/import functionality
```

**Commit**: `docs: add comprehensive task management documentation`

## Deployment and Testing

### Final Testing Checklist

1. **Unit Tests**
   - [ ] TaskService tests pass
   - [ ] API endpoint tests pass
   - [ ] React component tests pass
   - [ ] React hook tests pass

2. **Integration Tests**
   - [ ] Full task lifecycle works
   - [ ] Multi-agent assignment works
   - [ ] Real-time updates work
   - [ ] Session scoping works

3. **Manual Testing**
   - [ ] Web UI loads without errors
   - [ ] Can create tasks via UI
   - [ ] Can edit tasks and add notes
   - [ ] Can filter and search tasks
   - [ ] Real-time updates appear
   - [ ] Agent tools still work

4. **Performance Testing**
   - [ ] Task list loads quickly with 100+ tasks
   - [ ] Real-time updates don't cause lag
   - [ ] Database queries are efficient

### Deployment Steps

1. **Build and Test**
```bash
# Build entire project
npm run build

# Run all tests
npm test

# Run web-specific tests
npm test packages/web
```

2. **Database Migration**
```bash
# Migrations are automatic via TaskService
# Database tables created on first use
```

3. **Start Application**
```bash
# Development
npm run web:dev

# Production
npm run web:build
npm run web:start
```

## Summary

This implementation provides a complete human-visible task management system that:

1. **Lifts the task manager to core service** - Shared by both agents and humans
2. **Provides comprehensive web APIs** - REST endpoints for all operations
3. **Implements real-time UI** - React components with SSE updates
4. **Maintains agent compatibility** - Existing agent tools continue to work
5. **Follows best practices** - TDD, frequent commits, YAGNI principles

The system enables humans to effectively coordinate multi-agent workflows while preserving the core principle that agents communicate through tasks, not direct messaging.