# Enhanced Task Manager Implementation Specification

## Overview
Upgrade the existing task manager tool to support multi-agent workflows. Add fields for agent assignment, detailed prompts, timestamped notes, and better tracking.

## Background for Engineers

### Current Task Manager
- Location: `src/tools/implementations/task-manager.ts`
- Simple todo list with description, status, priority
- No concept of assignment or ownership
- Single global task list

### What We're Building
- Tasks can be assigned to specific agents (using thread IDs)
- Separate description (summary) from prompt (detailed instructions)
- Threaded notes for agent communication
- Tasks scoped to parent threads (which serve as sessions)

### Key Files to Understand
- `src/tools/implementations/task-manager.ts` - Current implementation
- `src/tools/tool.ts` - Base Tool class using Zod schemas
- `src/tools/types.ts` - Tool type definitions
- `src/tools/__tests__/task-manager.test.ts` - Existing tests

## Implementation Plan

### Phase 0: Create Thread ID Types

**Task 0.1: Create branded types for thread IDs**

File: `src/threads/types.ts`

Add branded types for type safety:
```typescript
// Branded type for thread IDs
export type ThreadId = string & { readonly __brand: 'ThreadId' };

// Type guard
export function isThreadId(value: string): value is ThreadId {
  return /^lace_\d{8}_[a-z0-9]{6}(\.\d+)*$/.test(value);
}

// Constructor
export function createThreadId(value: string): ThreadId {
  if (!isThreadId(value)) {
    throw new Error(`Invalid thread ID format: ${value}`);
  }
  return value as ThreadId;
}

// Unsafe cast for internal use only (e.g., when we know format is correct)
export function asThreadId(value: string): ThreadId {
  return value as ThreadId;
}

// For new agent specifications
export type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

export function isNewAgentSpec(value: string): value is NewAgentSpec {
  return /^new:([^\/]+)\/(.+)$/.test(value);
}

export function createNewAgentSpec(provider: string, model: string): NewAgentSpec {
  return `new:${provider}/${model}` as NewAgentSpec;
}

// Union type for task assignment
export type AssigneeId = ThreadId | NewAgentSpec;

export function isAssigneeId(value: string): value is AssigneeId {
  return isThreadId(value) || isNewAgentSpec(value);
}
```

Tests:
- Test thread ID validation (valid formats)
- Test thread ID rejection (invalid formats)
- Test hierarchical thread IDs (with dots)
- Test new agent spec validation
- Test type guards

**Commit**: "feat: add branded types for thread IDs"

**Task 0.2: Update existing code to use ThreadId type**

Update thread manager and related code to use the new types:
- `ThreadManager.generateThreadId()` should return `ThreadId`
- `Thread.id` should be `ThreadId`
- `ThreadEvent.threadId` should be `ThreadId`
- Update method signatures throughout

This is a larger refactoring that should be done carefully to maintain backward compatibility.

**Commit**: "refactor: use ThreadId branded type throughout codebase"

### Phase 1: Update Task Data Model

**Task 1.1: Extend Task interface**

File: `src/tools/implementations/task-manager.ts`

Current:
```typescript
interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}
```

New:
```typescript
import { ThreadId, AssigneeId } from '../../threads/types.js';

interface Task {
  id: string;
  title: string;              // Brief summary
  description: string;        // Human-readable details
  prompt: string;            // Detailed instructions for assigned agent
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: AssigneeId;   // ThreadId or NewAgentSpec
  createdBy: ThreadId;       // Full hierarchical thread ID of creating agent
  threadId: ThreadId;        // Parent thread ID only (e.g., "lace_20250703_abc123") 
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];
}

interface TaskNote {
  id: string;
  author: ThreadId;          // Full hierarchical thread ID of author
  content: string;
  timestamp: Date;
}
```

Write tests first:
- Test task creation with new fields
- Test backwards compatibility (missing fields)
- Test note addition

**Commit**: "feat: extend task data model for multi-agent support"

### Phase 2: Update Storage Layer

**Task 2.1: Migrate from in-memory to persistent storage**

Currently tasks are stored in agent memory. Need SQLite persistence.

File: `src/tools/implementations/task-manager/persistence.ts` (new)

```typescript
export class TaskPersistence {
  constructor(private dbPath: string) {}
  
  saveTask(task: Task): void
  loadTask(taskId: string): Task | null
  loadTasksByThread(threadId: string): Task[]
  loadTasksByAssignee(assignee: string): Task[]
  updateTask(taskId: string, updates: Partial<Task>): void
  addNote(taskId: string, note: Omit<TaskNote, 'id'>): void
}
```

Schema:
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked')) DEFAULT 'pending',
  priority TEXT CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
  assigned_to TEXT,          -- Full hierarchical thread ID or "new:provider/model"
  created_by TEXT NOT NULL,  -- Full hierarchical thread ID of creator
  thread_id TEXT NOT NULL,   -- Parent thread ID only (session)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,      -- Full hierarchical thread ID of author
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_tasks_thread_id ON tasks(thread_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_task_notes_task_id ON task_notes(task_id);
```

Tests:
- Test CRUD operations
- Test session filtering
- Test assignee filtering
- Test note ordering

**Commit**: "feat: add SQLite persistence for tasks"

### Phase 3: Update Tool Implementation

**Task 3.1: Update task creation tool**

File: `src/tools/implementations/task-manager.ts`

Update Zod schema:
```typescript
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  assignedTo: z.string().optional().describe('Thread ID or "new:provider/model"'),
});
```

Update execute method to handle new fields.

Tests:
- Test validation of required fields
- Test optional fields
- Test session scoping

**Commit**: "feat: update task creation for enhanced fields"

**Task 3.2: Add new task query tools**

Add new methods to TaskManager:
- `listMyTasks()` - Tasks assigned to current agent
- `listThreadTasks()` - All tasks in current thread
- `addNote(taskId, note)` - Add note to task
- `updateTaskStatus(taskId, status)` - Change status
- `reassignTask(taskId, newAssignee)` - Reassign task

Each needs:
- Zod schema
- Implementation
- Tests

**Commit**: "feat: add task query and update methods"

### Phase 4: Context Integration

**Task 4.1: Extend ToolContext**

First, update the base ToolContext interface:

File: `src/tools/types.ts`

```typescript
import { ThreadId } from '../threads/types.js';

export interface ToolContext {
  threadId?: ThreadId;
  // Add for multi-agent support:
  parentThreadId?: ThreadId;    // Parent thread (session)
}
```

**Task 4.2: Pass context from agent**

File: `src/agents/agent.ts` (update existing tool execution)

```typescript
// In tool execution method
const context: ToolContext = {
  threadId: this._getActiveThreadId(),
  parentThreadId: this._threadManager.getCanonicalId(this._threadId).split('.')[0],
};
```

**Task 4.3: Add task ID generation**

File: `src/tools/implementations/task-manager.ts`

```typescript
// Task ID follows similar pattern to thread IDs
private generateTaskId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `task_${date}_${random}`;
}
```

**Task 4.4: Use context in task manager**

File: `src/tools/implementations/task-manager.ts`

```typescript
import { createThreadId, isAssigneeId } from '../../threads/types.js';

protected async executeValidated(args: CreateTaskArgs, context?: ToolContext): Promise<ToolResult> {
  // Validate assignee if provided
  if (args.assignedTo && !isAssigneeId(args.assignedTo)) {
    throw new Error(`Invalid assignee format: ${args.assignedTo}`);
  }

  const task: Task = {
    id: this.generateTaskId(),
    title: args.title,
    description: args.description || '',
    prompt: args.prompt,
    priority: args.priority,
    status: 'pending',
    assignedTo: args.assignedTo as AssigneeId | undefined,
    createdBy: context?.threadId || createThreadId('lace_00000000_unknown'),
    threadId: context?.parentThreadId || context?.threadId || createThreadId('lace_00000000_unknown'),
    createdAt: new Date(),
    updatedAt: new Date(),
    notes: [],
  };
  
  // Save
}
```

Tests:
- Test context propagation
- Test task scoping by thread

**Commit**: "feat: integrate task manager with thread context"

### Phase 5: Update Task Display

**Task 7.1: Create TaskList formatter**

File: `src/tools/implementations/task-manager/formatter.ts` (new)

```typescript
import { ThreadId, AssigneeId } from '../../../threads/types.js';

export class TaskFormatter {
  static formatTaskList(tasks: Task[], options?: {
    showAssignee?: boolean;
    showNotes?: boolean;
    groupBy?: 'status' | 'assignee' | 'priority';
    threadMetadata?: Map<ThreadId, { displayName?: string }>;
  }): string
  
  static formatTask(task: Task, detailed?: boolean): string
  
  // Helper to show thread ID or display name
  private static formatAssignee(assignee: AssigneeId, metadata?: Map<ThreadId, { displayName?: string }>): string {
    // Handle "new:provider/model" format
    if (assignee.startsWith('new:')) {
      return assignee;
    }
    
    const threadId = assignee as ThreadId;
    const displayName = metadata?.get(threadId)?.displayName;
    return displayName || threadId.split('.').pop() || threadId;
  }
}
```

Output should be readable in CLI context.

Tests:
- Test various grouping options
- Test note formatting
- Test empty list handling

**Commit**: "feat: add task formatting utilities"

### Phase 8: Assignment Format Documentation

**Task 8.1: Document and validate assignment formats**

File: `src/tools/implementations/task-manager.ts`

Add validation and documentation:

```typescript
// Assignment format validation
const ASSIGNMENT_PATTERNS = {
  THREAD_ID: /^lace_\d{8}_[a-z0-9]{6}(\.\d+)*$/,  // Thread IDs
  NEW_AGENT: /^new:([^\/]+)\/(.+)$/,               // new:provider/model
};

function validateAssignment(assignedTo: string): { 
  type: 'thread' | 'new_agent'; 
  provider?: string; 
  model?: string;
} {
  if (ASSIGNMENT_PATTERNS.THREAD_ID.test(assignedTo)) {
    return { type: 'thread' };
  }
  
  const match = assignedTo.match(ASSIGNMENT_PATTERNS.NEW_AGENT);
  if (match) {
    return { 
      type: 'new_agent',
      provider: match[1],
      model: match[2]
    };
  }
  
  throw new Error(`Invalid assignment format: ${assignedTo}`);
}
```

**Assignment Formats**:
- Thread ID (e.g., `"lace_20250703_abc123.1"`) - Direct assignment to existing agent
- `"new:provider/model"` (e.g., `"new:anthropic/claude-3-haiku"`) - Request new agent creation

**Important**: Tasks with `"new:"` assignments:
- Remain in `"pending"` status until agent is created
- Cannot transition to `"in_progress"` without real thread ID
- The agent spawning system will update `assignedTo` with actual thread ID

Tests:
- Test thread ID validation
- Test new agent format parsing
- Test invalid format rejection

**Commit**: "feat: add assignment format validation"

### Phase 9: SQLite Concurrency Handling

**Task 9.1: Add WAL mode and retry logic**

File: `src/tools/implementations/task-manager/persistence.ts`

```typescript
constructor(private dbPath: string) {
  this.db = new Database(dbPath);
  
  // Enable WAL mode for better concurrency
  this.db.pragma('journal_mode = WAL');
  
  // Set busy timeout (5 seconds)
  this.db.pragma('busy_timeout = 5000');
}

// Add retry wrapper for write operations
private withRetry<T>(operation: () => T, maxRetries = 3): T {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return operation();
    } catch (error) {
      if (error.code === 'SQLITE_BUSY' && i < maxRetries - 1) {
        lastError = error;
        // Exponential backoff
        const delay = Math.min(100 * Math.pow(2, i), 1000);
        const end = Date.now() + delay;
        while (Date.now() < end); // Simple sleep
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Use in write operations - maintain async pattern for consistency
async saveTask(task: Task): Promise<void> {
  return this.withRetry(() => {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, title, description, prompt, status, priority, 
                        assigned_to, created_by, thread_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(task.id, task.title, task.description, task.prompt, 
             task.status, task.priority, task.assignedTo, 
             task.createdBy, task.threadId, task.createdAt.toISOString(), 
             task.updatedAt.toISOString());
  });
}
```

**Commit**: "feat: add SQLite concurrency handling"

### Phase 10: SQLite Performance Note

**Task 10.1: Document SQLite performance characteristics**

better-sqlite3 is synchronous by design and optimized for performance:
- Simple queries complete in microseconds
- WAL mode prevents reader/writer blocking
- Prepared statements are cached internally
- The async wrappers are for API consistency, not for actual async I/O

For the task manager's workload (CRUD operations on hundreds of tasks), synchronous SQLite is appropriate. If scale becomes an issue later, consider:
- Batching write operations
- Read-only replicas
- But don't over-engineer now (YAGNI)

**Commit**: "docs: add SQLite performance notes"

### Phase 11: Testing & Documentation

**Task 11.1: Integration tests**

File: `src/tools/implementations/__tests__/task-manager-integration.test.ts`

Test scenarios:
1. Multi-agent task workflow
2. Task assignment and reassignment
3. Note-based communication
4. Thread isolation
5. Concurrent task updates
6. "new:provider/model" format validation (not spawning - that's handled by agent system)

**Task 11.2: Update documentation**

- Update tool description in the class
- Add examples of multi-agent usage
- Document the data model changes

## Migration Strategy

### Database Setup
```sql
-- Create tables if they don't exist
-- The persistence layer should run this on initialization
```

### No Migration Needed
- In-memory tasks don't persist across restarts
- New task system starts fresh with proper schema
- Old task data is inherently temporary

## Testing Checklist

### Unit Tests
- [ ] Task CRUD operations
- [ ] Note management
- [ ] Query filtering
- [ ] Schema validation
- [ ] Context handling

### Integration Tests
- [ ] Multi-agent workflows
- [ ] Thread isolation (no task bleed between parent threads)
- [ ] Persistence reliability
- [ ] Migration from old format
- [ ] Concurrent access handling
- [ ] Event emission verification

### Manual Testing
1. Create tasks without assignment
2. Assign task to existing thread ID
3. Assign task with "new:anthropic/claude-3-haiku" format
4. Add notes from multiple agents
5. Query tasks by various filters
6. Verify thread isolation
7. Test task reassignment
8. Verify audit trail in thread events

## Common Pitfalls

### For React Developers New to Node.js
- No React here - this is backend TypeScript
- Zod schemas provide runtime validation (like PropTypes)
- SQLite operations are synchronous but wrapped in async for consistency
- Tools return strings, not JSX

### For Developers New to AI Agents
- Agents identified by thread IDs (e.g., "lace_20250703_abc123.1")
- Parent threads serve as sessions
- Tasks are the primary communication method
- Prompt field contains full context for agent
- Thread IDs are hierarchical: parent.child.grandchild

## Dependencies
- better-sqlite3 (already in project)
- zod (already in project)
- No new dependencies needed

## Performance Considerations
- Indexes already defined in schema (thread_id, assigned_to, status)
- Lazy load notes (only when requested)
- Limit task history queries (default last 100)
- Use prepared statements for all queries
- WAL mode enables concurrent reads

## Rollout Plan
1. Deploy with backwards compatibility
2. Migrate existing tasks
3. Update agents to use new fields
4. Enable multi-agent features
