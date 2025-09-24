# Delegate Tool Refactoring and Error Handling Improvements

## Overview

This plan addresses multiple issues discovered during the model invocation refactoring:

1. **Tool Selection Confusion**: Agents confuse `task_add` and `delegate` tools due to overlapping functionality
2. **Poor Error Messages**: Tool validation failures provide minimal context for debugging
3. **Missing Trajectory Adjustment**: Tool validation failures aren't sent back to the model for correction
4. **Inconsistent APIs**: Similar functionality has different interfaces

## Background Context

### Current State

**Two tools with overlapping functionality:**

```typescript
// task_add: Create tasks in the task system
{
  tasks: [{
    title: string,
    prompt: string,
    priority?: 'high' | 'medium' | 'low',
    assignedTo?: string  // ThreadId or NewAgentSpec
  }]
}

// delegate: Create subagent with different API
{
  title: string,
  prompt: string,
  expected_response: string,
  model: string  // 'fast' | 'smart' | 'provider:model'
}
```

**Problems:**
- Agents don't know which tool to use for subagent creation
- Different APIs for essentially the same underlying operation
- Agent tried to call `task_add` with `delegate` parameters
- Tool validation errors don't help model course-correct

### Root Cause Analysis

The agent received: "create a task... and assign it to a new subagent"

**Agent reasoning probably was:**
1. "Create a task" → use `task_add` tool
2. "Assign to subagent" → somehow add subagent parameters
3. Result: called `task_add` with `delegate` parameters

**The issue:** The tools have conceptual overlap but different APIs, causing confusion.

## Implementation Plan

### Phase 1: Improve Error Handling (Priority: Critical)

#### Task 1: Enhance Tool Validation Error Messages

**Goal**: Provide actionable error messages that help agents choose the correct tool.

**Files to modify:**
- `packages/core/src/tools/executor.ts`
- `packages/core/src/agents/agent.ts` (error handling)

**Changes needed:**

1. **Enhanced validation error format:**
```typescript
interface ToolValidationError {
  tool: string;
  attemptedCall: {
    name: string;
    arguments: Record<string, unknown>;
  };
  schemaErrors: string[];
  suggestions?: string[];
  providerContext: {
    instanceId: string;
    modelId: string;
  };
}
```

2. **Add suggestion system for common mistakes:**
```typescript
const TOOL_CONFUSION_HINTS = {
  task_add: {
    invalidParams: ['expected_response', 'model'],
    suggestion: "Did you mean to use the 'delegate' tool? The 'delegate' tool accepts 'expected_response' and 'model' parameters for subagent assignment."
  },
  delegate: {
    invalidParams: ['tasks', 'assignedTo'],
    suggestion: "Did you mean to use the 'task_add' tool? The 'task_add' tool accepts 'tasks' array for task creation."
  }
};
```

3. **Improved error message format:**
```
Tool call validation failed for 'task_add':

Attempted call:
{
  "tasks": [{
    "title": "Come up with ideas for AI email tool",
    "prompt": "Research and brainstorm ideas...",
    "expected_response": "List of creative ideas",  // ← Invalid parameter
    "model": "fast"                                  // ← Invalid parameter
  }]
}

Schema errors:
- /tasks/0: additionalProperties 'expected_response', 'model' not allowed

Suggestion: Did you mean to use the 'delegate' tool? The 'delegate' tool accepts 'expected_response' and 'model' parameters for subagent assignment.

Provider context: openai-dev / gpt-4
```

**Implementation:**

```typescript
// In ToolExecutor.execute()
try {
  const validatedArgs = tool.validateArgs(args);
  return await tool.execute(validatedArgs, context);
} catch (error) {
  if (error instanceof ToolValidationError) {
    const enhancedError = this.enhanceValidationError(toolCall, error, context);

    // Send enhanced error back to agent for trajectory adjustment
    return {
      status: 'error',
      content: [{
        type: 'text',
        text: enhancedError.userFriendlyMessage
      }],
      metadata: {
        validationError: enhancedError,
        canRetry: true,
        suggestions: enhancedError.suggestions
      }
    };
  }
  throw error;
}
```

**Testing:**
```bash
# Create specific test for validation error enhancement
npx vitest run src/tools/executor-validation-errors.test.ts
```

**Commit**: `feat: enhance tool validation error messages with suggestions and context`

---

#### Task 2: Ensure Tool Validation Failures Reach the Model

**Goal**: Tool validation failures should be sent as TOOL_RESULT events so the model can adjust.

**Files to modify:**
- `packages/core/src/agents/agent.ts`
- `packages/core/src/tools/executor.ts`

**Current flow (broken):**
```
Model sends TOOL_CALL → ToolExecutor validates → Validation fails → ???
```

**Desired flow (fixed):**
```
Model sends TOOL_CALL → ToolExecutor validates → Validation fails → TOOL_RESULT with error → Model gets feedback
```

**Implementation:**

```typescript
// In Agent.handleToolCall()
const toolResult = await this.toolExecutor.execute(toolCall, context);

// Always emit TOOL_RESULT, even for validation failures
this.threadManager.addEvent(this.threadId, {
  type: 'TOOL_RESULT',
  timestamp: new Date(),
  data: {
    id: toolCall.id,
    name: toolCall.name,
    result: toolResult,
    isValidationError: toolResult.metadata?.validationError ? true : false
  }
});

// Continue conversation with validation error as context
if (toolResult.status === 'error' && toolResult.metadata?.canRetry) {
  // Don't throw - let model see the error and adjust
  return; // Continue processing with error as context
}
```

**Testing:**
```typescript
// Test that validation failures create TOOL_RESULT events
it('should create TOOL_RESULT event for validation failures', async () => {
  const agent = createTestAgent();

  // Send invalid tool call
  await agent.handleMessage({
    role: 'user',
    content: 'test',
    tool_calls: [{
      id: 'test',
      name: 'task_add',
      arguments: { invalid: 'params' }
    }]
  });

  const events = getEventsForThread(agent.threadId);
  const toolResult = events.find(e => e.type === 'TOOL_RESULT');

  expect(toolResult).toBeDefined();
  expect(toolResult.data.result.status).toBe('error');
  expect(toolResult.data.isValidationError).toBe(true);
});
```

**Commit**: `feat: ensure tool validation failures create TOOL_RESULT events for model feedback`

---

#### Task 3: Improve Provider Context in Error Messages

**Goal**: Show useful provider instance and model info instead of generic "Provider: openai".

**Files to modify:**
- Error handling throughout the system
- Agent error formatting
- Event emission context

**Current (useless):**
```
Provider: openai
```

**Desired (useful):**
```
Provider: openai-dev (gpt-4)
```

**Implementation:**

```typescript
// Add to ToolContext
interface ToolContext {
  // ... existing fields
  providerContext?: {
    instanceId: string;
    modelId: string;
    displayName?: string;
  };
}

// Update Agent to pass provider context
const context: ToolContext = {
  agent: this,
  signal: this.abortController.signal,
  providerContext: {
    instanceId: this.metadata.providerInstanceId,
    modelId: this.metadata.modelId,
    displayName: this.getDisplayName()
  }
};
```

**Commit**: `feat: include detailed provider context in tool execution and error messages`

---

### Phase 2: Unify Delegate and Task APIs (Priority: High)

#### Task 4: Design Unified Delegate API

**Goal**: Replace delegate tool's single-task API with task-array API compatible with task_add.

**Current delegate API:**
```typescript
{
  title: string,
  prompt: string,
  expected_response: string,
  model: string
}
```

**Proposed unified API:**
```typescript
{
  tasks: [{
    title: string,
    prompt: string,
    expected_response?: string,  // Optional - for delegation clarity
    priority?: 'high' | 'medium' | 'low'
  }],
  assignTo: string  // NewAgentSpec: 'new:persona' | 'new:persona;fast' | 'new:persona;provider:model'
}
```

**Benefits:**
- Familiar array format for agents
- Supports bulk delegation to same agent
- Clear separation: tasks = what to do, assignTo = who does it
- Consistent with task_add API
- Uses our new flexible NewAgentSpec format

**Breaking change strategy:**
- Update delegate tool implementation
- Update tool description and examples
- Update any existing delegate calls in tests
- Add deprecation notice for old format (if needed)

---

#### Task 5: Implement Unified Delegate API

**Files to modify:**
- `packages/core/src/tools/implementations/delegate.ts`

**Implementation:**

```typescript
const delegateSchema = z.object({
  tasks: z.array(
    z.object({
      title: NonEmptyString,
      prompt: NonEmptyString,
      expected_response: NonEmptyString.optional(),
      priority: z.enum(['high', 'medium', 'low']).default('medium')
    })
  ).min(1).max(10),
  assignTo: z.string().describe('NewAgentSpec: "new:persona[;modelSpec]" where modelSpec is "fast", "smart", or "provider:model"')
});

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Delegate tasks to a subagent and wait for completion.

Creates tasks in the task system, assigns them to a new agent, and waits for all tasks to complete.
The subagent starts fresh with only your instructions - no conversation history.

Agent specification (assignTo):
- "new:lace" - Use session default model
- "new:lace;fast" - Use configured fast model
- "new:lace;smart" - Use configured smart model
- "new:lace;provider:model" - Use specific provider and model

Examples:
delegate({
  tasks: [{
    title: "Research email composition tools",
    prompt: "Research existing AI tools that help users compose emails. Focus on features, pricing, and user feedback.",
    expected_response: "Structured list of tools with key features and analysis"
  }],
  assignTo: "new:lace;fast"
})

delegate({
  tasks: [
    { title: "Analyze logs", prompt: "Check error logs for patterns", expected_response: "Error summary" },
    { title: "Check metrics", prompt: "Review performance metrics", expected_response: "Performance report" }
  ],
  assignTo: "new:lace;smart"
})`;

  schema = delegateSchema;

  protected async executeValidated(args: z.infer<typeof delegateSchema>, context?: ToolContext): Promise<ToolResult> {
    const { tasks, assignTo } = args;

    // Validate NewAgentSpec format
    if (!isNewAgentSpec(assignTo)) {
      return this.createError(`Invalid agent specification: ${assignTo}. Expected NewAgentSpec format like "new:lace;fast"`);
    }

    // Create all tasks with the same agent assignment
    const createdTasks = [];
    for (const taskData of tasks) {
      const task = await taskManager.createTask({
        title: taskData.title,
        prompt: this.formatDelegatePrompt(taskData.prompt, taskData.expected_response),
        priority: taskData.priority,
        assignedTo: assignTo
      }, { actor: context?.agent?.threadId || 'delegate' });

      createdTasks.push(task);
    }

    // Wait for all tasks to complete
    const results = await Promise.all(
      createdTasks.map(task => this.waitForTaskCompletion(task.id, taskManager, context))
    );

    return this.createResult(results, {
      taskIds: createdTasks.map(t => t.id),
      assignedAgent: assignTo
    });
  }
}
```

**Commit**: `feat: unify delegate API with task_add format using NewAgentSpec`

---

#### Task 6: Update Tool Tests for New Delegate API

**Files to modify:**
- `packages/core/src/tools/delegate.test.ts`
- Any other tests using delegate tool

**Test updates:**
```typescript
it('should delegate tasks using unified API', async () => {
  testSetup.setMockResponses(['Research complete', 'Analysis done']);

  const result = await tool.execute({
    tasks: [{
      title: 'Research email tools',
      prompt: 'Find AI email composition tools',
      expected_response: 'Tool comparison table'
    }],
    assignTo: createNewAgentSpec('lace', 'fast')
  }, context);

  expect(result.status).toBe('completed');
  expect(result.content).toHaveLength(1);
  expect(result.metadata?.taskIds).toHaveLength(1);
});

it('should support bulk delegation', async () => {
  testSetup.setMockResponses(['Task 1 done', 'Task 2 done']);

  const result = await tool.execute({
    tasks: [
      { title: 'Task 1', prompt: 'Do task 1', expected_response: 'Result 1' },
      { title: 'Task 2', prompt: 'Do task 2', expected_response: 'Result 2' }
    ],
    assignTo: 'new:lace;smart'
  }, context);

  expect(result.status).toBe('completed');
  expect(result.content).toHaveLength(2);
  expect(result.metadata?.taskIds).toHaveLength(2);
});
```

**Commit**: `test: update delegate tool tests for unified API`

---

### Phase 3: Error Message and Logging Improvements

#### Task 7: Implement Enhanced Tool Validation Error Messages

**Goal**: Provide detailed, actionable error messages when tool calls fail validation.

**Files to modify:**
- `packages/core/src/tools/tool.ts` (base Tool class)
- `packages/core/src/tools/executor.ts`

**Implementation:**

```typescript
// Enhanced validation error class
export class ToolValidationError extends Error {
  constructor(
    public tool: string,
    public attemptedCall: { name: string; arguments: Record<string, unknown> },
    public schemaErrors: string[],
    public suggestions: string[] = []
  ) {
    super(`Tool validation failed for ${tool}`);
    this.name = 'ToolValidationError';
  }

  toDetailedMessage(providerContext?: { instanceId: string; modelId: string }): string {
    const provider = providerContext
      ? `${providerContext.instanceId} (${providerContext.modelId})`
      : 'unknown';

    return `Tool call validation failed for '${this.tool}':

Attempted call:
${JSON.stringify(this.attemptedCall, null, 2)}

Schema errors:
${this.schemaErrors.map(err => `- ${err}`).join('\n')}

${this.suggestions.length > 0 ? `\nSuggestions:\n${this.suggestions.map(s => `- ${s}`).join('\n')}` : ''}

Provider: ${provider}`;
  }
}

// In Tool.validateArgs()
try {
  return this.schema.parse(args);
} catch (error) {
  if (error instanceof z.ZodError) {
    const suggestions = this.generateSuggestions(args, error);
    throw new ToolValidationError(
      this.name,
      { name: this.name, arguments: args },
      error.errors.map(e => `${e.path.join('/')}: ${e.message}`),
      suggestions
    );
  }
  throw error;
}

// Add suggestion generation
protected generateSuggestions(args: Record<string, unknown>, error: z.ZodError): string[] {
  const suggestions: string[] = [];

  // Check for common tool confusion patterns
  if (this.name === 'task_add' && ('expected_response' in args || 'model' in args)) {
    suggestions.push("Use 'delegate' tool instead - it accepts 'expected_response' and 'model' for subagent assignment");
  }

  if (this.name === 'delegate' && 'tasks' in args) {
    suggestions.push("Use 'task_add' tool instead - it accepts 'tasks' array for task creation");
  }

  return suggestions;
}
```

**Testing:**
```typescript
it('should provide helpful suggestions for tool confusion', async () => {
  const tool = new TaskCreateTool();

  const invalidArgs = {
    tasks: [{
      title: 'Test',
      prompt: 'Test',
      expected_response: 'Should fail',  // Invalid for task_add
      model: 'fast'                       // Invalid for task_add
    }]
  };

  try {
    tool.validateArgs(invalidArgs);
    expect.fail('Should have thrown validation error');
  } catch (error) {
    expect(error).toBeInstanceOf(ToolValidationError);
    expect(error.suggestions).toContain("Use 'delegate' tool instead");
  }
});
```

**Commit**: `feat: add comprehensive tool validation error messages with suggestions`

---

#### Task 8: Ensure Validation Errors Create TOOL_RESULT Events

**Goal**: Tool validation failures should flow back to the model as TOOL_RESULT events.

**Files to modify:**
- `packages/core/src/agents/agent.ts`

**Current problematic flow:**
```typescript
// Agent.handleToolCall()
try {
  const result = await this.toolExecutor.execute(toolCall, context);
  // Only successful results create TOOL_RESULT events
} catch (error) {
  // Validation errors get thrown and break the conversation
  throw error;
}
```

**Fixed flow:**
```typescript
// Agent.handleToolCall()
try {
  const result = await this.toolExecutor.execute(toolCall, context);

  // Create TOOL_RESULT for both success and validation errors
  this.threadManager.addEvent(this.threadId, {
    type: 'TOOL_RESULT',
    timestamp: new Date(),
    data: {
      id: toolCall.id,
      name: toolCall.name,
      result: result,
      isError: result.status === 'error',
      isValidationError: result.metadata?.validationError ? true : false
    }
  });

  // For validation errors, continue conversation (don't throw)
  if (result.status === 'error' && result.metadata?.canRetry) {
    logger.info('Tool validation failed, sending error to model for trajectory adjustment', {
      threadId: this.threadId,
      toolName: toolCall.name,
      error: result.content[0]?.text
    });
    return; // Let conversation continue with error context
  }

} catch (error) {
  // Only throw for unexpected errors, not validation failures
  throw error;
}
```

**Testing:**
```typescript
it('should send validation errors back to model for course correction', async () => {
  const agent = createTestAgent();
  const mockProvider = new MockProvider();

  // Send invalid tool call
  await agent.sendMessage('Create a task', [{
    id: 'test_123',
    name: 'task_add',
    arguments: { invalid: 'parameters' }
  }]);

  // Should create TOOL_RESULT event
  const events = getThreadEvents(agent.threadId);
  const toolResult = events.find(e => e.type === 'TOOL_RESULT');
  expect(toolResult).toBeDefined();
  expect(toolResult.data.isValidationError).toBe(true);

  // Should not throw or break conversation
  expect(agent.status).toBe('idle'); // Not crashed

  // Should send error context to provider for next response
  expect(mockProvider.lastMessages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'test_123',
      content: expect.stringContaining('Tool call validation failed')
    })
  );
});
```

**Commit**: `feat: send tool validation failures to model as TOOL_RESULT events`

---

### Phase 4: Tool Description and Documentation Updates

#### Task 9: Update Tool Descriptions for Clarity

**Goal**: Make it crystal clear when to use `task_add` vs `delegate`.

**Files to modify:**
- `packages/core/src/tools/implementations/task-manager/tools.ts`
- `packages/core/src/tools/implementations/delegate.ts`

**Updated descriptions:**

```typescript
// task_add description
description = `Create tasks to track work within the current conversation.

USE WHEN:
- Planning work for yourself or current conversation
- Breaking down complex requests into manageable pieces
- Creating tasks for human review or manual work
- Tracking progress on multi-step work

DO NOT USE FOR:
- Creating work for subagents (use 'delegate' tool instead)
- One-off research or analysis tasks (use 'delegate' tool instead)

ASSIGNMENT OPTIONS:
- Leave unassigned for manual assignment later
- assignedTo: "human" for human tasks
- assignedTo: "lace_20250101_abc123" for existing agent threads
- assignedTo: "new:persona;modelSpec" to spawn new agent (but consider 'delegate' tool instead)

Examples:
- Planning: task_add({ tasks: [{ title: "Add auth tests", prompt: "Write unit tests for auth module" }] })
- Human task: task_add({ tasks: [{ title: "Review PR", prompt: "Code review needed", assignedTo: "human" }] })`;

// delegate description
description = `Delegate tasks to a new subagent and wait for completion.

USE WHEN:
- Need focused work done by a subagent (research, analysis, implementation)
- Want to use specific model for cost/performance optimization
- Need work done independently with clear deliverables
- Want to run work in parallel while you continue other tasks

WORKFLOW:
1. Creates tasks in task system
2. Spawns new agent with specified model
3. Waits for all tasks to complete
4. Returns aggregated results

The subagent starts fresh with only your instructions - no conversation history.

Agent specification (assignTo):
- "new:lace" - Use session default model
- "new:lace;fast" - Use configured fast model (cost-effective)
- "new:lace;smart" - Use configured smart model (higher reasoning)
- "new:lace;provider:model" - Use specific provider and model

Examples:
delegate({
  tasks: [{
    title: "Research email composition tools",
    prompt: "Research existing AI tools for email composition. Include features, pricing, user reviews.",
    expected_response: "Structured comparison table with recommendations"
  }],
  assignTo: "new:lace;fast"
})`;
```

**Commit**: `docs: clarify task_add vs delegate tool usage with clear guidelines`

---

#### Task 10: Add Integration Tests for New Delegate API

**Files to create:**
- `packages/core/src/tools/delegate-unified-api.integration.test.ts`

**Test scenarios:**
```typescript
describe('Delegate Tool Unified API Integration', () => {
  it('should work with task array format and NewAgentSpec', async () => {
    // Test the new unified API matches task creation patterns
  });

  it('should support bulk delegation to same agent', async () => {
    // Test multiple tasks assigned to one agent
  });

  it('should integrate with existing task management tools', async () => {
    // Test that delegated tasks appear in task_list, can be updated with task_update, etc.
  });

  it('should provide clear error for invalid NewAgentSpec', async () => {
    // Test validation errors are helpful
  });
});
```

**Commit**: `test: add integration tests for unified delegate API`

---

## Success Criteria

### Phase 1 (Error Handling) - Critical
- [ ] Tool validation failures create detailed, actionable error messages
- [ ] Error messages include full tool call context and suggestions
- [ ] Validation failures create TOOL_RESULT events sent to model
- [ ] Provider context shows instance ID and model, not just provider name
- [ ] Models can course-correct after validation failures

### Phase 2 (API Unification) - High Priority
- [ ] Delegate tool accepts task array format like task_add
- [ ] assignTo parameter uses NewAgentSpec format
- [ ] Backward compatibility maintained during transition
- [ ] Tool descriptions clearly differentiate use cases
- [ ] All existing delegate functionality preserved

### Integration Tests
- [ ] Agent confusion scenario resolved (task_add vs delegate)
- [ ] Bulk delegation works with new API
- [ ] Error trajectory adjustment works end-to-end
- [ ] Provider context appears correctly in error logs

## Risk Mitigation

### Breaking Changes
- New delegate API is breaking change - update all tests
- Consider gradual migration if needed
- Document migration path for any external users

### Error Handling Changes
- Ensure validation errors don't break existing error handling
- Test that critical errors still bubble up appropriately
- Verify agent stability with new error flow

### Performance Considerations
- Enhanced error messages shouldn't impact happy path performance
- Bulk delegation shouldn't create excessive database load
- Tool validation performance should remain fast

## Testing Strategy

### Unit Tests
- Tool validation error enhancement
- NewAgentSpec parsing in delegate tool
- Error message formatting

### Integration Tests
- End-to-end tool call failure and recovery
- Bulk delegation workflow
- Agent trajectory adjustment after errors

### Manual Testing
1. Trigger the original failure scenario
2. Verify agent gets helpful error and course-corrects
3. Test bulk delegation with new API
4. Verify error messages are actionable

## Rollback Plan

1. **Phase 1**: Low risk - error improvements are additive
2. **Phase 2**: Revert delegate tool schema if issues arise
3. **Database**: No database changes - purely API/interface changes
4. **Tests**: Comprehensive test coverage ensures safe changes

## Timeline

- **Phase 1**: 2-3 hours (critical error handling fixes)
- **Phase 2**: 3-4 hours (API unification)
- **Testing/Polish**: 1-2 hours
- **Total**: ~6-9 hours for complete implementation

## Post-Implementation

### Documentation Updates
- Update CLAUDE.md with new delegate API examples
- Update tool usage patterns in agent personas
- Document error handling improvements

### Monitoring
- Track tool validation error rates
- Monitor agent tool selection patterns
- Watch for any new confusion patterns

## Notes

This plan addresses the fundamental architectural issue where two tools (task_add and delegate) have overlapping functionality but different APIs, causing agent confusion. The unified approach makes the system more coherent and easier to use correctly.

The error handling improvements ensure that when agents do make mistakes, they get enough information to self-correct rather than failing silently or crashing.

---

## Implementation Status

**Completed on 2025-09-21:**

### Phase 1: Enhanced Error Messages ✅
- **Task 1**: Enhanced tool validation error messages in `Tool` base class
  - Added detailed error formatting with received args, validation errors, and valid parameters
  - Includes metadata for programmatic error handling
  - Tests: `src/tools/tool.test.ts` and `src/tools/validation-flow.test.ts`

### Phase 2: Tool Validation Flow ✅
- **Task 2**: Confirmed validation failures create TOOL_RESULT events
  - Validation errors already flow back as TOOL_RESULT with `status: 'failed'`
  - Format converters mark these as errors for provider (`is_error: true`)
  - Integration tests verify complete flow

### Phase 3: Unified Delegate API ✅
- **Task 4-6**: Updated delegate tool to match task_add format
  - Changed from single task to `tasks` array format
  - Changed from `model` to `assignTo` with NewAgentSpec format
  - Supports bulk delegation like task_add
  - Tests: `src/tools/implementations/delegate-unified.test.ts`
  - Updated existing tests: `delegate-task-based.test.ts`

### Documentation Updates ✅
- Updated delegate tool description with new examples
- Shows unified API format matching task_add
- Clear NewAgentSpec format documentation

### Not Implemented (Future Work):
- **Task 3**: Provider context improvements (not critical for current issue)
- **Task 8**: Debug logging improvements (can be added as needed)

The main objectives have been achieved: tool validation errors now provide clear, actionable messages, and the delegate tool API has been unified with task_add for consistency.
