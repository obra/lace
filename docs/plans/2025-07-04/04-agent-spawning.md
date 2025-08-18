# Agent Spawning Implementation Specification

## Overview
Enable task-based agent spawning by extending the existing delegate pattern and task manager. Agents are created when tasks are assigned to "new:provider/model" and inherit the existing thread hierarchy.

## Background for Engineers

### Current Delegate Pattern
- Location: `src/tools/implementations/delegate.ts`
- Creates child threads: `parent.1`, `parent.2`, etc.
- Temporary sub-agents for specific tasks
- Returns to parent when done

### What We're Adding
- Persistent child threads (don't terminate when task done)
- Task assignment to "new:provider/model" triggers agent creation
- UI can switch between child threads
- No complex agent management - just thread switching

### Key Files to Understand
- `src/tools/implementations/delegate.ts` - Current delegation pattern
- `src/tools/implementations/task-manager.ts` - Task assignment
- `src/threads/thread-manager.ts` - Thread creation and management
- `src/agents/agent.ts` - Agent initialization

## Implementation Plan

### Phase 1: Extend Task Assignment

**Task 1.1: Update task creation to support agent spawning**

File: `src/tools/implementations/task-manager.ts`

Update `assignedTo` handling:
```typescript
// In task creation
if (args.assignedTo?.startsWith('new:')) {
  // Parse: "new:anthropic/claude-3-sonnet"
  const [, providerModel] = args.assignedTo.split(':');
  const [provider, model] = providerModel.split('/');
  
  // Create agent and assign task
  const agentId = await this.createTaskAgent(provider, model, task);
  task.assignedTo = agentId;
}
```

Tests:
- Test "new:provider/model" parsing
- Test invalid format rejection
- Test agent creation triggered

**Commit**: "feat: add new agent spawning to task assignment"

**Task 1.2: Add createTaskAgent method**

File: `src/tools/implementations/task-manager.ts`

```typescript
private async createTaskAgent(
  provider: string, 
  model: string, 
  task: Task
): Promise<string> {
  // Get current session (parent thread)
  const parentThreadId = this.context?.threadId;
  if (!parentThreadId) {
    throw new Error('No session context for agent creation');
  }
  
  // Create delegate thread (reuse existing pattern)
  const delegateThread = this.threadManager.createDelegateThreadFor(parentThreadId);
  const agentThreadId = delegateThread.id;
  
  // Store agent metadata (simple approach)
  await this.storeAgentMetadata(agentThreadId, {
    name: `agent-${Date.now()}`, // Or generate better name
    provider,
    model,
    type: 'ephemeral',
    createdFor: task.id,
    parentThreadId
  });
  
  // Send task notification to new agent
  await this.notifyTaskAssignment(agentThreadId, task);
  
  return agentThreadId;
}
```

Implementation notes:
- Reuse `ThreadManager.createDelegateThreadFor()` 
- Store minimal metadata in SQLite
- Send task as first message to agent

Tests:
- Test thread creation
- Test metadata storage
- Test task notification

**Commit**: "feat: implement task-based agent creation"

### Phase 2: Agent Metadata Storage

**Task 2.1: Add agent metadata table**

File: `src/tools/implementations/task-manager/persistence.ts`

```sql
CREATE TABLE agent_metadata (
  thread_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  type TEXT CHECK(type IN ('persistent', 'ephemeral')) NOT NULL,
  created_for_task TEXT,
  parent_thread_id TEXT NOT NULL,
  current_task TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_for_task) REFERENCES tasks(id),
  FOREIGN KEY (parent_thread_id) REFERENCES threads(id)
);
```

Add methods:
```typescript
storeAgentMetadata(threadId: string, metadata: AgentMetadata): void
getAgentMetadata(threadId: string): AgentMetadata | null
listSessionAgents(parentThreadId: string): AgentMetadata[]
updateCurrentTask(threadId: string, taskDescription: string): void
```

Tests:
- Test metadata CRUD
- Test session filtering
- Test foreign key constraints

**Commit**: "feat: add agent metadata persistence"

### Phase 3: Agent Initialization

**Task 3.1: Add Agent.createForTask static method**

File: `src/agents/agent.ts`

```typescript
static async createForTask(
  threadId: string,
  provider: string,
  model: string,
  task: Task,
  dependencies: {
    providerRegistry: ProviderRegistry;
    toolExecutor: ToolExecutor;
    threadManager: ThreadManager;
  }
): Promise<Agent> {
  // Create provider instance
  const providerInstance = await dependencies.providerRegistry.createProvider(
    provider,
    model
  );
  
  // Create agent with restricted tools (no delegate to prevent recursion)
  const tools = dependencies.toolExecutor.getAvailableTools()
    .filter(tool => tool.name !== 'delegate');
  
  const agent = new Agent({
    provider: providerInstance,
    toolExecutor: dependencies.toolExecutor,
    threadManager: dependencies.threadManager,
    threadId,
    tools,
  });
  
  // Send initial task notification
  await agent.queueMessage(formatTaskAssignment(task), 'task_notification');
  
  return agent;
}
```

This is just a factory method, not a separate class.

Tests:
- Test agent creation
- Test tool filtering
- Test initial task message

**Commit**: "feat: add Agent.createForTask factory method"

### Phase 4: Notification Integration

**Task 4.1: Add task notification helpers**

File: `src/tools/implementations/task-manager/notifications.ts` (new)

Note: The buffered notifications spec (03-buffered-notifications.md) references `src/agents/notifications.ts` for these formatters, but they should actually be implemented here in the task manager since they're part of the task system integration.

```typescript
export function formatTaskAssignment(task: Task): string {
  return `[LACE TASK SYSTEM] You have been assigned a new task:
Title: "${task.title}"
Created by: ${task.createdBy || 'system'}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---`;
}

export function formatTaskCompletion(task: Task): string {
  return `[LACE TASK SYSTEM] Task completed notification:
Task: "${task.title}"
Status: ${task.status.toUpperCase()}

${task.notes?.length ? 'Recent notes:\n' + task.notes.slice(-3).map(n => `- ${n.content}`).join('\n') : ''}`;
}
```

**Commit**: "feat: add task notification formatters"

**Task 4.2: Add completion notifications**

Update task status changes to notify relevant agents:

```typescript
// In task-manager when status changes to 'completed'
if (oldStatus !== 'completed' && newStatus === 'completed') {
  // Notify creator if it's an agent
  if (task.createdBy && task.createdBy !== task.assignedTo) {
    await this.notifyTaskCompletion(task.createdBy, task);
  }
}
```

Tests:
- Test completion notifications sent
- Test no self-notification
- Test notification content

**Commit**: "feat: add task completion notifications"

### Phase 5: Thread Switching Support

**Task 5.1: Add thread switching utilities**

File: `src/agents/agent-utils.ts` (new)

```typescript
export function getSessionAgents(
  parentThreadId: string,
  taskManager: TaskManager
): Array<{ threadId: string; name: string; currentTask?: string }> {
  return taskManager.listSessionAgents(parentThreadId);
}

export async function switchToAgent(
  threadId: string,
  agentFactory: typeof Agent.createForTask,
  dependencies: AgentDependencies
): Promise<Agent> {
  const metadata = dependencies.taskManager.getAgentMetadata(threadId);
  if (!metadata) {
    throw new Error(`No agent found for thread ${threadId}`);
  }
  
  // For now, create new instance (could cache later)
  return Agent.createForTask(
    threadId,
    metadata.provider,
    metadata.model,
    null, // No initial task
    dependencies
  );
}
```

This provides utilities for the UI layer without complex state management.

Tests:
- Test agent listing
- Test thread switching
- Test missing agent handling

**Commit**: "feat: add agent switching utilities"

## Testing Strategy

### Unit Tests
- Task assignment parsing
- Agent metadata CRUD
- Notification formatting
- Thread creation

### Integration Tests
- End-to-end task assignment and agent creation
- Task completion notifications
- Multi-agent workflows

### Manual Testing
1. Create task with `assignedTo: "new:anthropic/claude-3-sonnet"`
2. Verify agent thread created
3. Verify task notification sent
4. Complete task, verify notification to creator

## Migration from Delegate

This builds on the existing delegate pattern:
- Delegate creates temporary agents
- Task assignment creates persistent agents
- Same thread hierarchy (`parent.1`, `parent.2`)
- No breaking changes to delegate tool

## Key Differences from Original Spec

1. **No AgentFactory class** - Just static method on Agent
2. **No agent-spawn tool** - Happens through task assignment
3. **No active agent concept** - Just thread switching
4. **No pause/resume** - Idle agents use no resources
5. **No complex lifecycle** - Agents exist or they don't
6. **CLI agnostic** - UI handles agent switching

This is much simpler and builds directly on existing patterns rather than creating new infrastructure.