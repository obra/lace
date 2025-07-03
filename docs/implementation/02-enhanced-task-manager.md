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
- Tasks can be assigned to specific agents
- Separate description (summary) from prompt (detailed instructions)
- Threaded notes for agent communication
- Tasks scoped to sessions

### Key Files to Understand
- `src/tools/implementations/task-manager.ts` - Current implementation
- `src/tools/tool.ts` - Base Tool class using Zod schemas
- `src/tools/types.ts` - Tool type definitions
- `src/tools/__tests__/task-manager.test.ts` - Existing tests

## Implementation Plan

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
interface Task {
  id: string;
  title: string;              // Brief summary
  description: string;        // Human-readable details
  prompt: string;            // Detailed instructions for assigned agent
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: string;       // Agent name or "new:provider/model"
  createdBy?: string;        // Agent that created task
  sessionId?: string;        // Group tasks by session
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];
}

interface TaskNote {
  id: string;
  author: string;            // Agent name
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
  loadTasksBySession(sessionId: string): Task[]
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
  prompt TEXT,
  status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked')),
  priority TEXT CHECK(priority IN ('high', 'medium', 'low')),
  assigned_to TEXT,
  created_by TEXT,
  session_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
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
  title: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  assignedTo: z.string().optional(),
  sessionId: z.string().optional(),
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
- `listSessionTasks(sessionId)` - All tasks in session
- `addNote(taskId, note)` - Add note to task
- `updateTaskStatus(taskId, status)` - Change status

Each needs:
- Zod schema
- Implementation
- Tests

**Commit**: "feat: add task query and update methods"

### Phase 4: Context Integration

**Task 4.1: Add session context to task manager**

The task manager needs to know:
- Current session ID
- Current agent name

File: `src/tools/implementations/task-manager.ts`

```typescript
interface TaskContext {
  sessionId?: string;
  agentName?: string;
  threadId?: string;
}

class TaskManagerTool extends Tool {
  private context?: TaskContext;
  
  setContext(context: TaskContext): void {
    this.context = context;
  }
}
```

This context comes from the agent/thread system.

Tests:
- Test context affects task creation
- Test filtering by context

**Commit**: "feat: add session context to task manager"

### Phase 5: Update Task Display

**Task 5.1: Create TaskList formatter**

File: `src/tools/implementations/task-manager/formatter.ts` (new)

```typescript
export class TaskFormatter {
  static formatTaskList(tasks: Task[], options?: {
    showAssignee?: boolean;
    showNotes?: boolean;
    groupBy?: 'status' | 'assignee' | 'priority';
  }): string
  
  static formatTask(task: Task, detailed?: boolean): string
}
```

Output should be readable in CLI context.

Tests:
- Test various grouping options
- Test note formatting
- Test empty list handling

**Commit**: "feat: add task formatting utilities"

### Phase 6: Testing & Documentation

**Task 6.1: Integration tests**

File: `src/tools/implementations/__tests__/task-manager-integration.test.ts`

Test scenarios:
1. Multi-agent task workflow
2. Task assignment and reassignment
3. Note-based communication
4. Session isolation

**Task 6.2: Update documentation**

- Update tool description in the class
- Add examples of multi-agent usage
- Document the data model changes

## Migration Strategy

### Backwards Compatibility
- Old tasks without new fields should still work
- Add migration to populate missing fields
- Provide defaults for required fields

### Data Migration
```typescript
function migrateTask(oldTask: OldTask): Task {
  return {
    ...oldTask,
    title: oldTask.description.split('\n')[0], // First line
    prompt: oldTask.description,
    notes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
```

## Testing Checklist

### Unit Tests
- [ ] Task CRUD operations
- [ ] Note management
- [ ] Query filtering
- [ ] Schema validation
- [ ] Context handling

### Integration Tests
- [ ] Multi-agent workflows
- [ ] Session isolation
- [ ] Persistence reliability
- [ ] Migration from old format

### Manual Testing
1. Create tasks without assignment
2. Assign task to agent
3. Add notes from multiple agents
4. Query tasks by various filters
5. Verify session isolation

## Common Pitfalls

### For React Developers New to Node.js
- No React here - this is backend TypeScript
- Zod schemas provide runtime validation (like PropTypes)
- SQLite is synchronous - no need for async/await
- Tools return strings, not JSX

### For Developers New to AI Agents
- Agents identified by name, not user ID
- Sessions group related agents
- Tasks are the primary communication method
- Prompt field contains full context for agent

## Dependencies
- better-sqlite3 (already in project)
- zod (already in project)
- No new dependencies needed

## Performance Considerations
- Index on session_id and assigned_to
- Lazy load notes (only when requested)
- Limit task history queries
- Cache active session tasks

## Rollout Plan
1. Deploy with backwards compatibility
2. Migrate existing tasks
3. Update agents to use new fields
4. Enable multi-agent features