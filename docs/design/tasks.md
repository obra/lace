# Task Management System Design

## Overview

The Lace task management system provides a shared coordination mechanism between human users and AI agents. It implements a centralized task queue that enables multi-agent workflows without direct agent-to-agent communication. All tasks are session-scoped, persisted in SQLite, and support real-time updates via Server-Sent Events (SSE).

## Core Philosophy

1. **Tasks as Communication Channel**: Agents don't message each other directly. Instead, they communicate through shared tasks.
2. **Session Scoping**: All tasks belong to a session (parent thread), providing natural isolation.
3. **Human-Agent Parity**: Both humans and agents can create, assign, and complete tasks through the same system.
4. **Real-time Updates**: Changes propagate immediately to all connected clients via SSE.
5. **Event-Driven Architecture**: Task operations emit events that drive UI updates and notifications.

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Web UI Layer                            │
│  TaskDashboard → useTaskManager → useTaskStream → SSE       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      API Layer                               │
│  REST Endpoints → SessionService → Session → TaskManager    │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      Core Layer                              │
│  TaskManager (EventEmitter) → DatabasePersistence → SQLite  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      Agent Layer                             │
│  Agent Tools → TaskManager (same instance as API)           │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Task Creation**:
   ```
   Human/Agent → API/Tool → TaskManager → Database → Event Emission → SSE → UI Update
   ```

2. **Task Updates**:
   ```
   Update Request → TaskManager → Validate → Database → Event Emission → SSE → UI Update
   ```

3. **Real-time Sync**:
   ```
   TaskManager.emit() → SSE Endpoint → EventSource → useTaskStream → React State Update
   ```

## Data Model

### Task

```typescript
interface Task {
  id: string;                    // task_YYYYMMDD_random (e.g., task_20250716_abc123)
  title: string;                 // Brief summary (required)
  description: string;           // Human-readable details
  prompt: string;                // Instructions for assigned agent (required)
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: AssigneeId;       // ThreadId, "new:provider/model", or undefined
  createdBy: ThreadId;           // Who created the task
  threadId: ThreadId;            // Parent session ID
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];             // Communication thread
}
```

### TaskNote

```typescript
interface TaskNote {
  id: string;                    // note_YYYYMMDD_random
  author: ThreadId;              // Who wrote the note
  content: string;               // Note text
  timestamp: Date;
}
```

### Task Context

```typescript
interface TaskContext {
  actor: string;                 // ThreadId of the actor
  isHuman?: boolean;             // true for humans, false/undefined for agents
}
```

### Assignment Types

Tasks can be assigned to:
- **Specific Agent**: Full thread ID (e.g., `lace_20250716_abc123.1`)
- **Human**: Represented as `"human"` in the UI, stored as session ID
- **New Agent**: Specification format `new:provider/model` (e.g., `new:anthropic/claude-3-sonnet`)
- **Unassigned**: `undefined` assignedTo field

## Core Components

### 1. TaskManager (`src/tasks/task-manager.ts`)

Central task management service that:
- Extends EventEmitter for real-time updates
- Provides CRUD operations for tasks
- Manages task notes
- Enforces session scoping
- Emits events: `task:created`, `task:updated`, `task:deleted`, `task:note_added`

Key methods:
- `createTask(request, context)`: Create new task
- `getTasks(filters?)`: List tasks with optional filtering
- `getTaskById(taskId)`: Get specific task
- `updateTask(taskId, updates, context)`: Update task properties
- `addNote(taskId, content, context)`: Add communication note
- `deleteTask(taskId, context)`: Remove task
- `getTaskSummary()`: Get status counts

### 2. Session Integration (`src/sessions/session.ts`)

Each Session instance:
- Creates its own TaskManager instance
- Provides `getTaskManager()` method
- Shares TaskManager between agent tools and web APIs
- Ensures all operations are session-scoped

### 3. Agent Tools (`src/tools/implementations/task-manager/`)

Six tools that agents use:
- `TaskCreateTool`: Create new tasks
- `TaskListTool`: List and filter tasks
- `TaskCompleteTool`: Mark tasks as completed
- `TaskUpdateTool`: Update task properties
- `TaskAddNoteTool`: Add notes to tasks
- `TaskViewTool`: View detailed task information

All tools get TaskManager instance from the session context.

### 4. Web API Endpoints

#### Task CRUD Operations
- `GET /api/tasks?sessionId=xxx`: List tasks with filters
- `POST /api/tasks`: Create new task
- `GET /api/tasks/[taskId]?sessionId=xxx`: Get task details
- `PATCH /api/tasks/[taskId]`: Update task
- `DELETE /api/tasks/[taskId]?sessionId=xxx`: Delete task

#### Task Notes
- `POST /api/tasks/[taskId]/notes`: Add note to task

#### Real-time Updates
- `GET /api/tasks/stream?sessionId=xxx`: SSE endpoint for live updates

### 5. React Hooks

#### useTaskManager (`packages/web/hooks/useTaskManager.ts`)
Main hook for task operations:
- Manages task state
- Provides CRUD operations
- Integrates with SSE for real-time updates
- Handles loading and error states

#### useTaskStream (`packages/web/hooks/useTaskStream.ts`)
SSE integration hook:
- Connects to task event stream
- Provides callbacks for each event type
- Manages EventSource lifecycle

### 6. UI Components

- `TaskDashboard`: Main task management interface
- `TaskList`: Display tasks with sorting/filtering
- `TaskListItem`: Individual task display
- `TaskDetailModal`: View/edit task details
- `TaskNotes`: Note thread within tasks
- `CreateTaskModal`: Task creation form
- `TaskSummary`: Status overview widget
- `TaskFilters`: Filtering controls

## Event System

### Event Types

1. **task:created**
   ```typescript
   {
     type: 'task:created',
     task: Task,
     context: TaskContext,
     timestamp: string
   }
   ```

2. **task:updated**
   ```typescript
   {
     type: 'task:updated',
     task: Task,
     context: TaskContext,
     timestamp: string
   }
   ```

3. **task:deleted**
   ```typescript
   {
     type: 'task:deleted',
     taskId: string,
     task: Task,
     context: TaskContext,
     timestamp: string
   }
   ```

4. **task:note_added**
   ```typescript
   {
     type: 'task:note_added',
     task: Task,
     context: TaskContext,
     timestamp: string
   }
   ```

### Event Flow

1. TaskManager operation occurs
2. TaskManager emits event via EventEmitter
3. SSE endpoint (`/api/tasks/stream`) listens for events
4. Events are serialized and sent to connected clients
5. useTaskStream hook receives events
6. useTaskManager hook updates local state
7. React components re-render

## Database Schema

### Tasks Table
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  priority TEXT CHECK (priority IN ('high', 'medium', 'low')),
  assigned_to TEXT,
  created_by TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Task Notes Table
```sql
CREATE TABLE task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

## Security & Permissions

1. **Session Scoping**: Tasks are isolated by session - no cross-session access
2. **Context Tracking**: All operations include actor context for audit trail
3. **Human Identification**: Human actions tracked with `isHuman: true` flag
4. **No Direct Database Access**: All operations go through TaskManager
5. **Event Validation**: SSE only broadcasts to authorized session connections

## Real-time Synchronization

The system maintains consistency across multiple clients:

1. **Optimistic Updates**: UI updates immediately on user action
2. **Event Broadcasting**: Changes propagate to all session participants
3. **Automatic Reconnection**: SSE reconnects on connection loss
4. **State Reconciliation**: Full task list refetched on reconnection

## Usage Patterns

### Creating a Task (Human)
```typescript
// Via UI
const { createTask } = useTaskManager(sessionId);
await createTask({
  title: "Implement authentication",
  description: "Add user login functionality",
  prompt: "Create a secure authentication system using JWT tokens",
  priority: "high",
  assignedTo: "lace_20250716_abc123.1"
});
```

### Creating a Task (Agent)
```yaml
tools:
  - name: task-create
    arguments:
      title: "Write unit tests"
      description: "Add test coverage for auth module"
      prompt: "Write comprehensive unit tests for all authentication functions"
      priority: "medium"
      assigned_to: "new:anthropic/claude-3-haiku"
```

### Multi-Agent Coordination
```
1. Human creates task → assigns to PM agent
2. PM agent breaks down task → creates subtasks
3. PM assigns subtasks → different specialist agents
4. Agents work on tasks → update status and add notes
5. Agents complete tasks → PM reviews and reports back
6. Human sees real-time updates → throughout entire process
```

## Performance Considerations

1. **Event Batching**: Multiple rapid updates batched in UI
2. **Lazy Loading**: Task notes loaded on-demand
3. **Index Optimization**: Database indexed on thread_id, assigned_to
4. **Connection Pooling**: SSE connections reused where possible
5. **Memory Management**: Old completed tasks can be archived

## Future Enhancements

1. **Task Dependencies**: Define prerequisite relationships
2. **Task Templates**: Reusable task patterns
3. **Bulk Operations**: Update multiple tasks at once
4. **Search**: Full-text search across tasks and notes
5. **Analytics**: Task completion metrics and agent performance
6. **Webhooks**: External integrations for task events
7. **Archival**: Automatic archiving of old completed tasks
8. **Permissions**: Fine-grained access control per task

## Testing Strategy

### Unit Tests
- TaskManager operations (`src/tasks/__tests__/task-manager.test.ts`)
- API endpoints (`packages/web/app/api/tasks/__tests__/`)
- React hooks (`packages/web/hooks/__tests__/`)
- React components (`packages/web/components/__tests__/`)

### Integration Tests
- Full task lifecycle
- Multi-agent workflows
- SSE event propagation
- Session isolation

### E2E Tests
- Create task → assign → update → complete flow
- Real-time updates across multiple clients
- Error handling and recovery

## Common Issues & Solutions

### Issue: Tasks not updating in real-time
**Solution**: Check SSE connection in browser DevTools Network tab. Ensure session ID matches.

### Issue: Task assignment to "new:provider/model" not spawning agent
**Solution**: Agent spawning is handled by the agent system separately. The task remains assigned to the specification until an agent claims it.

### Issue: Deleted tasks reappearing
**Solution**: Check for SSE reconnection causing full refresh. Ensure delete events are processed correctly.

### Issue: Notes appearing out of order
**Solution**: Notes are ordered by timestamp from database. Check system clock synchronization.

## Code Examples

### Adding a Custom Task Filter
```typescript
// In TaskManager
getTasksByCustomFilter(predicate: (task: Task) => boolean): Task[] {
  return this.getTasks().filter(predicate);
}

// In API endpoint
const urgentUnassigned = taskManager.getTasksByCustomFilter(
  task => task.priority === 'high' && !task.assignedTo
);
```

### Implementing Task Notifications
```typescript
// In useTaskManager
useEffect(() => {
  const handleTaskAssigned = (event: TaskEvent) => {
    if (event.task?.assignedTo === currentUserId) {
      showNotification(`New task assigned: ${event.task.title}`);
    }
  };
  
  taskStream.on('task:updated', handleTaskAssigned);
  return () => taskStream.off('task:updated', handleTaskAssigned);
}, [currentUserId]);
```

### Batch Task Updates
```typescript
// In TaskManager
async updateMultipleTasks(
  updates: Array<{ taskId: string; changes: Partial<Task> }>,
  context: TaskContext
): Promise<Task[]> {
  const results = [];
  for (const { taskId, changes } of updates) {
    const updated = await this.updateTask(taskId, changes, context);
    results.push(updated);
  }
  return results;
}
```

## Conclusion

The task management system successfully bridges human and agent collaboration by providing a shared, real-time workspace. Its event-driven architecture ensures consistency across all clients while maintaining clean separation between layers. The system's flexibility allows for future enhancements without breaking existing functionality.