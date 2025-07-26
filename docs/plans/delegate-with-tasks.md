# Replace Delegate Tool with Task-Based Implementation

## Overview

Replace the current direct-communication delegate tool with a task-based implementation that supports parallel execution when the LLM backend makes multiple delegate tool calls simultaneously.

**Note**: This plan leverages the existing agent spawning infrastructure (Phase 1 complete) and web UI architecture rather than implementing the original agent spawning spec's separate components.

## Problem Statement

The current delegate tool has shared state that causes conflicts when multiple delegate calls are executed in parallel:

```typescript
export class DelegateTool extends Tool {
  private parentAgent?: Agent;           // ⚠️ SHARED STATE
  private parentToolExecutor?: ToolExecutor; // ⚠️ SHARED STATE
}
```

When the LLM makes multiple delegate tool calls in a single response:
```json
{
  "tool_calls": [
    {"name": "delegate", "args": {"title": "Parse logs", ...}},
    {"name": "delegate", "args": {"title": "Count files", ...}},  
    {"name": "delegate", "args": {"title": "Check tests", ...}}
  ]
}
```

All three calls execute simultaneously and interfere with each other through shared state.

## Solution: Task-Based Delegate Tool

Replace the direct agent communication with task-based delegation that leverages the existing agent spawning infrastructure.

### Benefits
- **Natural parallelism**: Each delegate call gets its own isolated agent
- **No shared state**: Zero possibility of conflicts between parallel calls
- **Consistent architecture**: Aligns with multi-agent task-based coordination
- **Better observability**: All delegations are trackable in the database
- **Resource management**: Agents managed by session lifecycle

### Architecture

```
Old: Parent Agent → Direct Message → Sub-agent → Response
New: Parent Agent → Task Creation → Agent Spawning → Task Completion → Response
```

## Implementation Plan

### Phase 1: Implement New Task-Based Delegate Tool

**File**: `src/tools/implementations/delegate.ts`

Replace the entire implementation:

```typescript
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import { TaskManager } from '~/tasks/task-manager';
import { logger } from '~/utils/logger';

// Model format validation
const ModelFormat = z.string().refine(
  (value) => {
    const [providerName, modelName] = value.split(':');
    return providerName && modelName;
  },
  {
    message: 'Invalid model format. Use "provider:model" (e.g., "anthropic:claude-3-5-haiku-latest")',
  }
);

const delegateSchema = z.object({
  title: NonEmptyString.describe(
    'Short active voice sentence describing the task (e.g., "Find security vulnerabilities")'
  ),
  prompt: NonEmptyString.describe('Complete instructions for the subagent - be specific and clear'),
  expected_response: NonEmptyString.describe(
    'Description of the expected format/content of the response (guides the subagent)'
  ),
  model: ModelFormat.default('anthropic:claude-3-5-haiku-latest').describe(
    'Provider and model in format "provider:model"'
  ),
});

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Delegate a specific task to a subagent using a less expensive model.
Creates a persistent agent that executes the task and returns the result.
Supports parallel execution when multiple delegate calls are made simultaneously.

Examples:
- title: "Analyze test failures", prompt: "Review the test output and identify the root cause of failures", expected_response: "List of failing tests with specific error reasons"
- title: "Search authentication logs", prompt: "grep through the application logs for authentication errors in the last hour", expected_response: "Timestamps and error messages for each auth failure"
- title: "Count code statistics", prompt: "Count total lines of code, number of files, and test coverage percentage", expected_response: "JSON with {loc: number, files: number, coverage: number}"`;

  schema = delegateSchema;
  annotations: ToolAnnotations = {
    openWorldHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { title, prompt, expected_response, model } = args;

      // Get TaskManager from context
      const taskManager = this.getTaskManagerFromContext(context);
      
      // Parse provider:model format
      const [providerName, modelName] = model.split(':');

      // Create task with agent spawning
      const task = await taskManager.createTask({
        title,
        prompt: this.formatDelegatePrompt(prompt, expected_response),
        assignedTo: `new:${providerName}/${modelName}`,
        priority: 'high'
      }, {
        actor: context?.threadId || 'unknown'
      });

      logger.debug('DelegateTool: Created task for delegation', {
        taskId: task.id,
        title,
        model: `${providerName}/${modelName}`
      });

      // Wait for task completion via events
      const result = await this.waitForTaskCompletion(task.id, taskManager, context?.threadId || 'unknown');
      
      logger.debug('DelegateTool: Task completed', {
        taskId: task.id,
        resultLength: result.length
      });

      return this.createResult(result, {
        taskTitle: title,
        taskId: task.id
      });

    } catch (error: unknown) {
      return this.createError(
        `Delegate tool execution failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Check the parameters and try again.`
      );
    }
  }

  private getTaskManagerFromContext(context?: ToolContext): TaskManager {
    // TaskManager should be available through context or session
    // This will need to be implemented based on how ToolContext is structured
    throw new Error('TaskManager context access needs implementation');
  }

  private formatDelegatePrompt(prompt: string, expectedResponse: string): string {
    return `${prompt}

IMPORTANT: Your response should match this format/structure:
${expectedResponse}

Please complete the task and provide your response in the expected format.`;
  }

  private async waitForTaskCompletion(taskId: string, taskManager: TaskManager, creatorThreadId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const handleTaskUpdate = (event: any) => {
        if (event.task.id === taskId && event.creatorThreadId === creatorThreadId) {
          if (event.task.status === 'completed') {
            taskManager.off('task:updated', handleTaskUpdate);
            const response = this.extractResponseFromTask(event.task);
            resolve(response);
          } else if (event.task.status === 'blocked') {
            taskManager.off('task:updated', handleTaskUpdate);
            reject(new Error(`Task ${taskId} is blocked`));
          }
        }
      };
      
      taskManager.on('task:updated', handleTaskUpdate);
    });
  }

  private extractResponseFromTask(task: any): string {
    // Get the agent's response from task notes
    const response = task.notes
      .filter((note: any) => note.author !== task.createdBy) // Exclude creator's notes
      .map((note: any) => note.content)
      .join('\n\n');
    
    return response || 'Task completed without response';
  }
}
```

### Phase 2: Update Tool Context Integration and Event System

**File**: `src/sessions/session.ts`

Add concurrent task limit enforcement and tool filtering:

```typescript
private static readonly MAX_CONCURRENT_DELEGATE_TASKS = 16;

private async setupAgentCreationCallback(): void {
  const agentCreationCallback: AgentCreationCallback = async (
    provider: string,
    model: string,
    task
  ) => {
    // Check concurrent task limit
    const activeTasks = this._taskManager.getTasks({ status: 'in_progress' });
    const delegateTasks = activeTasks.filter(t => t.assignedTo?.startsWith('lace_'));
    
    if (delegateTasks.length >= Session.MAX_CONCURRENT_DELEGATE_TASKS) {
      throw new Error(`Maximum concurrent delegate tasks (${Session.MAX_CONCURRENT_DELEGATE_TASKS}) exceeded`);
    }

    // Create agent with context inheritance and tool filtering
    const agent = this.spawnAgentWithFilteredTools(`task-${task.id.split('_').pop()}`, provider, model);
    
    // Set up error handler for task failure on agent crash
    agent.on('error', (error) => {
      this._taskManager.updateTask(task.id, { status: 'blocked' }, { actor: agent.threadId });
    });

    // Inherit context from parent
    this.inheritParentContext(agent);
    
    await this.sendTaskNotification(agent, task);
    return asThreadId(agent.threadId);
  };

  this._taskManager = new TaskManager(
    this._sessionId,
    this._taskManager['persistence'],
    agentCreationCallback
  );
}

private spawnAgentWithFilteredTools(name: string, provider?: string, model?: string): Agent {
  // Create filtered tool executor without delegate tool to prevent recursion
  const filteredToolExecutor = new ToolExecutor();
  const allTools = this._sessionAgent.toolExecutor.getAllTools();
  const toolsWithoutDelegate = allTools.filter(tool => tool.name !== 'delegate');
  filteredToolExecutor.registerTools(toolsWithoutDelegate);
  
  // Copy approval callback
  const approvalCallback = this._sessionAgent.toolExecutor.getApprovalCallback();
  if (approvalCallback) {
    filteredToolExecutor.setApprovalCallback(approvalCallback);
  }

  // Use existing spawnAgent logic but with filtered tools
  const agentName = name.trim() || 'Lace';
  const targetProvider = provider || this._sessionAgent.providerName;
  const targetModel = model || this._sessionAgent.providerInstance.modelName;

  // Create provider instance if needed
  let providerInstance = this._sessionAgent.providerInstance;
  if (
    targetProvider !== this._sessionAgent.providerName ||
    targetModel !== this._sessionAgent.providerInstance.modelName
  ) {
    const registry = ProviderRegistry.createWithAutoDiscovery();
    providerInstance = registry.createProvider(targetProvider, { model: targetModel });
  }

  // Create delegate agent with filtered tools
  const agent = this._sessionAgent.createDelegateAgent(filteredToolExecutor, providerInstance);

  // Store the agent metadata
  agent.updateThreadMetadata({
    name: agentName,
    isAgent: true,
    parentSessionId: this._sessionId,
    provider: targetProvider,
    model: targetModel,
  });

  this._agents.set(asThreadId(agent.threadId), agent);
  return agent;
}

private inheritParentContext(agent: Agent): void {
  // Inherit working directory and environment from session
  const sessionWorkingDir = this.getWorkingDirectory();
  const sessionEnv = this.getEffectiveConfiguration().environment || {};
  
  agent.updateThreadMetadata({
    ...agent.getThreadMetadata(),
    workingDirectory: sessionWorkingDir,
    environment: sessionEnv,
  });
}
```

### Phase 2b: Update Tool Context Integration and Event System

**File**: `src/tools/types.ts`

Ensure ToolContext provides access to TaskManager:

```typescript
export interface ToolContext {
  threadId?: ThreadId;
  parentThreadId?: ThreadId;
  taskManager?: TaskManager; // Add this
}
```

**File**: `src/agents/agent.ts`

Update tool execution to pass TaskManager in context:

```typescript
// In tool execution method
const context: ToolContext = {
  threadId: this._getActiveThreadId(),
  parentThreadId: this._threadManager.getCanonicalId(this._threadId).split('.')[0],
  taskManager: this._session?.getTaskManager() // Add this
};
```

**File**: `src/tasks/task-manager.ts`

Update task events to include creator threadId for filtering:

```typescript
// In updateTask method
this.emit('task:updated', {
  type: 'task:updated',
  task: updatedTask,
  creatorThreadId: updatedTask.createdBy, // Add for event filtering
  context,
  timestamp: new Date().toISOString(),
});
```

### Phase 3: Update Agent-Task Communication

The spawned agents need to communicate their results back through task notes rather than direct responses.

**File**: `src/agents/agent.ts`

Add method to update task with response:

```typescript
private async updateTaskWithResponse(response: string): Promise<void> {
  // Get current task from metadata or context
  const currentTaskId = this.getThreadMetadata()?.currentTask;
  if (currentTaskId && this._session) {
    const taskManager = this._session.getTaskManager();
    await taskManager.addNote(currentTaskId, response, this._threadId);
    await taskManager.updateTask(currentTaskId, { status: 'completed' });
  }
}
```

Update agent message handling to detect task completion:

```typescript
// When agent completes a response, check if it's working on a task
private async handleResponseComplete(content: string): Promise<void> {
  await this.updateTaskWithResponse(content);
  // ... existing logic
}
```

### Phase 4: Remove Old Delegate Implementation

**Files to Update**:
- `src/tools/implementations/delegate.ts` - Replace entirely
- Remove any references to `setDependencies` method
- Update any tests that rely on the old implementation

### Phase 5: Update Session Agent Creation

**File**: `src/sessions/session.ts`

Update `setupAgentCreationCallback` to set task context on spawned agents:

```typescript
private async sendTaskNotification(agent: Agent, task: Task): Promise<void> {
  // Set the current task in agent metadata
  agent.updateThreadMetadata({
    ...agent.getThreadMetadata(),
    currentTask: task.id
  });

  const taskMessage = this.formatTaskAssignment(task);
  await agent.sendMessage(taskMessage);
}

private formatTaskAssignment(task: Task): string {
  return `[LACE TASK SYSTEM] You have been assigned a new task:
Title: "${task.title}"
Task ID: ${task.id}
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---

IMPORTANT TASK MANAGEMENT:
When you complete your work or encounter an issue:
1. Add your response as a task note using the task management tools
2. Update task status to 'completed' or 'blocked' 
3. This will automatically notify the parent agent

Task management tools are available for this purpose.

NOTE: Stuck tasks requiring human intervention will timeout and need manual resolution.`;
}
```

## Testing Strategy

### Unit Tests

**File**: `src/tools/implementations/delegate.test.ts`

```typescript
describe('Task-Based DelegateTool', () => {
  it('should create task and wait for completion', async () => {
    // Test single delegation
  });

  it('should handle parallel delegations without conflicts', async () => {
    // Test multiple simultaneous delegate calls
    const tool1 = new DelegateTool();
    const tool2 = new DelegateTool(); 
    const tool3 = new DelegateTool();

    const [result1, result2, result3] = await Promise.all([
      tool1.execute({title: "Task 1", prompt: "...", model: "anthropic:claude-3-haiku"}),
      tool2.execute({title: "Task 2", prompt: "...", model: "anthropic:claude-3-haiku"}),
      tool3.execute({title: "Task 3", prompt: "...", model: "anthropic:claude-3-haiku"})
    ]);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);
  });

  it('should handle task failures gracefully', async () => {
    // Test blocked/failed task scenarios
  });
});
```

### Integration Tests

**File**: `src/tools/implementations/delegate-integration.test.ts`

Test full delegation workflow with real agents and task manager.

## Migration Checklist

- [ ] Implement new task-based DelegateTool
- [ ] Update ToolContext to include TaskManager
- [ ] Update Agent to pass TaskManager in tool context
- [ ] Add agent-task communication for response handling
- [ ] Remove old delegate implementation and setDependencies
- [ ] Update Session agent creation to set task context
- [ ] Write comprehensive tests for parallel execution
- [ ] Update documentation and examples
- [ ] Test with real LLM parallel tool calls

## Risks and Mitigations

**Risk**: Event listener memory leaks
**Mitigation**: Ensure proper cleanup of event listeners on task completion/failure

**Risk**: Database contention with many parallel delegations
**Mitigation**: Optimize task queries and consider connection pooling

**Risk**: Agent resource accumulation
**Mitigation**: Keep spawned agents alive for reuse, but implement session-level cleanup on destroy

**Risk**: Spawned agent crashes without task update
**Mitigation**: Add agent error handlers that automatically mark tasks as blocked

**Risk**: Response formatting differences
**Mitigation**: Maintain consistent response format through task note aggregation

## Success Criteria

1. Multiple delegate tool calls execute in parallel without conflicts
2. All delegate responses are returned correctly
3. No shared state issues between parallel delegations
4. Task-based delegation maintains same API as old implementation
5. Performance is comparable or better than direct delegation
6. Full observability of all delegations through task system
7. Concurrent task limits prevent resource exhaustion (max 16 per session)
8. Context inheritance works (environment, working directory)
9. Agent error handling marks tasks as blocked automatically

## Timeline

- **Phase 1-2**: 2 days - Core implementation
- **Phase 3**: 1 day - Agent-task communication
- **Phase 4**: 1 day - Cleanup old implementation  
- **Phase 5**: 1 day - Session integration
- **Testing**: 2 days - Comprehensive testing
- **Total**: ~1 week

## Architecture Integration

### Relationship to Existing Systems

**Agent Spawning Infrastructure** (Phase 1 Complete):
- ✅ Task assignment to "new:provider/model" triggers agent creation
- ✅ TaskManager with AgentCreationCallback integration
- ✅ Thread metadata storage via `updateThreadMetadata()` / `getThreadMetadata()`
- ✅ Full test coverage for agent spawning functionality

**Web UI Architecture** (Fully Implemented):
- ✅ Real-time agent management via Next.js + SSE
- ✅ Session-scoped event streams for multi-agent coordination
- ✅ Dynamic agent creation through session API
- ✅ Task board modal for task management
- ✅ No thread switching needed - UI handles multiple agents

**Current Task System**:
- ✅ Full task CRUD operations with persistence
- ✅ Task notes and status management
- ✅ Event-driven task updates via SSE
- ✅ Integration with web UI task board

### Why This Approach Works Better

**vs. Original Agent Spawning Spec** (`docs/implementation/04-agent-spawning.md`):
- ❌ **Separate agent_metadata table** → ✅ **Thread metadata** (integrated, simpler)
- ❌ **Agent.createForTask() static method** → ✅ **Session.spawnAgent()** (proven pattern)
- ❌ **Thread switching utilities** → ✅ **Web UI management** (superior UX)
- ❌ **Manual task notifications** → ✅ **Event-driven SSE system** (real-time)

**vs. Current Delegate Tool**:
- ❌ **Shared state conflicts** → ✅ **Isolated task-based agents** (parallel-safe)
- ❌ **Direct communication** → ✅ **Database-mediated coordination** (observable)
- ❌ **Limited observability** → ✅ **Full task tracking** (web UI + persistence)
- ❌ **No resource limits** → ✅ **Concurrent task limits** (16 per session)

This replaces the problematic shared-state delegate tool with a robust, parallel-safe task-based implementation that leverages proven architecture patterns and existing infrastructure.