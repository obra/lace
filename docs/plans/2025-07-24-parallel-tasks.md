# Agent Tool Call Parallelization

**Date:** 2025-07-24  
**Status:** Planning Phase  
**Author:** Claude & Jesse  

## Executive Summary

The current Agent implementation processes tool calls sequentially using blocking `await` calls, which breaks in multiprocess environments and provides poor user experience. This document outlines a complete redesign to a fully event-driven architecture where tool execution is triggered by approval events rather than blocking Promises.

### Key Simplification
**Updated 2025-07-24**: After analysis, the solution is much simpler than initially planned:
- User rejections ARE error tool results (create TOOL_RESULT with isError: true immediately)
- Simple completion tracking: counter + rejection flag
- Auto-continue conversation ONLY if all tools complete AND no rejections exist
- If any rejections exist, wait for user input (no special states needed)
- User message + all tool results go to provider together

This eliminates complex state management while maintaining provider contract compliance.

## Current System Problems

### Sequential Tool Processing
When an LLM returns multiple tool calls, the Agent processes them one at a time:
1. Execute tool 1 → wait for approval → complete
2. Execute tool 2 → wait for approval → complete  
3. Execute tool 3 → wait for approval → complete

**User sees:** One approval request at a time, must approve each individually
**Should see:** All approval requests immediately, can approve in any order

### Process-Unsafe Blocking
```typescript
// Current broken pattern in Agent._executeToolCalls()
for (const toolCall of toolCalls) {
  const result = await this._toolExecutor.executeTool(toolCall); // ❌ BLOCKS
}
```

**Problems:**
- Agent stays blocked in `tool_execution` state with in-memory Promises
- NextJS multiprocess restarts lose Promise state
- Multiple agents can't execute tools simultaneously
- No recovery if process dies during tool execution

## New Event-Driven Architecture

### Core Principle: No Blocking
The Agent should never block on tool execution. Instead:
1. Fire all approval requests immediately
2. Go idle
3. Execution triggered by incoming approval events

### Event Flow

#### Scenario 1: All Tools Approved
```
LLM Response with 3 tool calls
↓
Agent creates 3 TOOL_CALL events
↓  
Agent creates 3 TOOL_APPROVAL_REQUEST events
↓
Agent goes IDLE (no blocking)
↓
User sees all 3 approval requests in UI
↓
User approves all 3 tools → 3 TOOL_APPROVAL_RESPONSE events
↓
Tools execute → 3 TOOL_RESULT events (all successful)
↓
Agent detects: all complete + no rejections
↓
Agent AUTO-CONTINUES conversation → sends tool results to LLM
```

#### Scenario 2: Any Tools Rejected
```
LLM Response with 3 tool calls
↓
Agent creates 3 TOOL_CALL events
↓  
Agent creates 3 TOOL_APPROVAL_REQUEST events
↓
Agent goes IDLE (no blocking)
↓
User approves tool 1, denies tool 2, approves tool 3
↓
Tools execute: 2 successful + 1 error TOOL_RESULT
↓
Agent detects: all complete + has rejections
↓
Agent WAITS (stays idle, no auto-continue)
↓
User sends message: "Try a different approach"
↓
Agent sends to LLM: all 3 tool results + user message
```

### Benefits
- ✅ **Process-safe**: No in-memory blocking state
- ✅ **Parallel approvals**: User sees all requests immediately  
- ✅ **Multi-agent support**: Multiple agents can have pending approvals
- ✅ **Recovery**: Process restart just re-attaches event listeners
- ✅ **Flexible execution**: Tools execute as approvals come in

## Implementation Plan

### Phase 1: Update Agent Tool Call Processing

#### Task 1.1: Remove Blocking from _executeToolCalls
**File:** `src/agents/agent.ts` (lines ~846-940)

**Current broken code:**
```typescript
private async _executeToolCalls(toolCalls: ProviderToolCall[]): Promise<void> {
  this._setState('tool_execution');
  
  for (const providerToolCall of toolCalls) {
    // Convert and add TOOL_CALL event
    const toolCall: ToolCall = { /* ... */ };
    this._addEventAndEmit(this._threadId, 'TOOL_CALL', toolCall);
    
    // ❌ BLOCKING EXECUTION
    const result = await this._toolExecutor.executeTool(toolCall, toolContext);
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
  }
}
```

**New non-blocking code:**
```typescript
private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
  // No longer async - doesn't block
  this._setState('tool_execution');
  
  // Initialize tool batch tracking
  this._pendingToolCount = toolCalls.length;
  this._hasRejectionsInBatch = false;
  
  for (const providerToolCall of toolCalls) {
    // Convert and add TOOL_CALL event
    const toolCall: ToolCall = {
      id: providerToolCall.id,
      name: providerToolCall.name,
      arguments: providerToolCall.input,
    };
    this._addEventAndEmit(this._threadId, 'TOOL_CALL', toolCall);
    
    // Emit start event for UI
    this.emit('tool_call_start', {
      toolName: providerToolCall.name,
      input: providerToolCall.input,
      callId: providerToolCall.id,
    });
    
    // NO EXECUTION HERE - just fire approval request
    // Tool execution will be triggered by approval events
  }
  
  // Agent goes idle immediately - no waiting
  this._setState('idle');
}
```

**Testing:**
- Write test that verifies Agent goes `idle` immediately after tool calls
- Test that multiple TOOL_CALL events are created for multiple tool calls
- Test that NO TOOL_RESULT events exist until approvals provided

**Files to modify:**
- `src/agents/agent.ts` - Update `_executeToolCalls` method
- `src/agents/agent.test.ts` - Add tests for new non-blocking behavior

#### Task 1.2: Remove Recursive _processConversation Call
**File:** `src/agents/agent.ts` (lines ~575-580)

**Current code:**
```typescript
if (response.toolCalls && response.toolCalls.length > 0) {
  await this._executeToolCalls(response.toolCalls);
  // ❌ RECURSIVE CALL AFTER TOOL EXECUTION
  await this._processConversation();
} else {
  // No tool calls, conversation is complete
  this._completeTurn();
  this._setState('idle');
  this.emit('conversation_complete');
}
```

**New code:**
```typescript
if (response.toolCalls && response.toolCalls.length > 0) {
  this._executeToolCalls(response.toolCalls); // No await
  // NO RECURSIVE CALL - tools will auto-continue or wait for user input
  // DON'T complete turn yet - wait for all tools to finish
} else {
  // No tool calls, conversation is complete
  this._completeTurn();
  this._setState('idle');
  this.emit('conversation_complete');
}
```

**Testing:**
- Test that Agent goes `idle` immediately after tool calls
- Test that Agent doesn't recursively process conversation
- Test that turn metrics are NOT completed until all tools finish
- Test that `conversation_complete` is only emitted when appropriate

### Phase 2: Event-Driven Tool Execution

#### Task 2.1: Add Tool Execution Event Handler to Agent
**File:** `src/agents/agent.ts`

**Add new method:**
```typescript
/**
 * Handle TOOL_APPROVAL_RESPONSE events by executing the approved tool
 */
private _handleToolApprovalResponse(event: ThreadEvent): void {
  if (event.type !== 'TOOL_APPROVAL_RESPONSE') return;
  
  const responseData = event.data as ToolApprovalResponseData;
  const { toolCallId, decision } = responseData;
  
  // Find the corresponding TOOL_CALL event
  const events = this._threadManager.getEvents(this._threadId);
  const toolCallEvent = events.find(e => 
    e.type === 'TOOL_CALL' && 
    (e.data as ToolCall).id === toolCallId
  );
  
  if (!toolCallEvent) {
    logger.error('AGENT: No TOOL_CALL event found for approval response', {
      threadId: this._threadId,
      toolCallId,
    });
    return;
  }
  
  const toolCall = toolCallEvent.data as ToolCall;
  
  if (decision === ApprovalDecision.DENY) {
    // Create error result for denied tool
    const errorResult: ToolResult = {
      id: toolCallId,
      isError: true,
      content: [{ type: 'text', text: 'Tool execution denied by user' }],
    };
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);
    
    // Track rejection
    this._hasRejectionsInBatch = true;
  } else {
    // Execute the approved tool
    this._executeSingleTool(toolCall);
  }
  
  // Check if all tools are complete
  this._pendingToolCount--;
  if (this._pendingToolCount === 0) {
    // All tools complete - decide what to do next
    if (this._hasRejectionsInBatch) {
      // Has rejections - wait for user input
      this._setState('idle');
      // Don't auto-continue conversation
    } else {
      // All approved - auto-continue conversation
      this._completeTurn();
      this._setState('idle');
      this._processConversation();
    }
  }
}

/**
 * Execute a single tool call without blocking
 */
private async _executeSingleTool(toolCall: ToolCall): Promise<void> {
  try {
    const workingDirectory = this._getWorkingDirectory();
    const toolContext = {
      threadId: asThreadId(this._threadId),
      parentThreadId: asThreadId(this._getParentThreadId()),
      workingDirectory,
    };
    
    // Execute tool - this will handle its own approval if needed
    const result = await this._toolExecutor.executeTool(toolCall, toolContext);
    
    // Add result event
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
    
  } catch (error) {
    logger.error('AGENT: Tool execution failed', {
      threadId: this._threadId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: error instanceof Error ? error.message : String(error),
    });
    
    const errorResult: ToolResult = {
      id: toolCall.id,
      isError: true,
      content: error instanceof Error ? error.message : 'Unknown error occurred',
    };
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);
  }
}
```

**Add properties to Agent class:**
```typescript
export class Agent extends EventEmitter {
  // ... existing properties ...
  
  // Simple tool batch tracking
  private _pendingToolCount = 0;
  private _hasRejectionsInBatch = false;
  
  // ... rest of class ...
}
```

**Add event listener in constructor:**
```typescript
constructor(config: AgentConfig) {
  super();
  // ... existing initialization ...
  
  // Listen for tool approval responses
  this.on('thread_event_added', ({ event }) => {
    if (event.type === 'TOOL_APPROVAL_RESPONSE') {
      this._handleToolApprovalResponse(event);
    }
  });
}
```

**Testing:**
- Test that TOOL_APPROVAL_RESPONSE events trigger tool execution
- Test that denied tools create error TOOL_RESULT events
- Test that approved tools execute and create success TOOL_RESULT events
- Test that multiple approval responses execute tools independently
- Test that Agent auto-continues conversation when all tools approved
- Test that Agent waits for user input when any tools rejected
- Test that batch completion tracking works correctly
- Test that turn metrics are completed at the right time

**Files to modify:**
- `src/agents/agent.ts` - Add event handler methods and listener
- `src/agents/agent.test.ts` - Add tests for event-driven execution

#### Task 2.2: Update EventApprovalCallback for Immediate Requests
**File:** `src/tools/event-approval-callback.ts`

**Current code waits for approval:**
```typescript
async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
  // Find TOOL_CALL event
  // Create TOOL_APPROVAL_REQUEST event  
  // Wait for TOOL_APPROVAL_RESPONSE event ← ❌ BLOCKING
  return this.waitForApprovalResponse(toolCallId);
}
```

**New code fires request immediately:**
```typescript
async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
  // Find the TOOL_CALL event that triggered this approval
  const toolCallEvent = this.findRecentToolCallEvent(toolName, input);
  if (!toolCallEvent) {
    throw new Error(`Could not find TOOL_CALL event for ${toolName}`);
  }
  
  const toolCallId = (toolCallEvent.data as ToolCall).id;
  
  // Check if approval response already exists (recovery case)
  const existingResponse = this.checkExistingApprovalResponse(toolCallId);
  if (existingResponse) {
    return existingResponse;
  }
  
  // Check if approval request already exists to avoid duplicates
  const existingRequest = this.checkExistingApprovalRequest(toolCallId);
  if (!existingRequest) {
    // Create TOOL_APPROVAL_REQUEST event and emit it immediately
    const event = this.threadManager.addEvent(this.threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: toolCallId,
    });
    
    // Emit the event so the SSE stream delivers it to the frontend immediately
    this.agent.emit('thread_event_added', { event, threadId: this.threadId });
  }
  
  // Instead of blocking, throw an error that indicates approval is pending
  // The Agent will handle this by NOT executing the tool yet
  throw new ApprovalPendingError(toolCallId);
}
```

**Add new error type:**
```typescript
export class ApprovalPendingError extends Error {
  constructor(public readonly toolCallId: string) {
    super(`Tool approval pending for ${toolCallId}`);
    this.name = 'ApprovalPendingError';
  }
}
```

**Testing:**
- Test that `requestApproval` throws `ApprovalPendingError` instead of blocking
- Test that TOOL_APPROVAL_REQUEST events are created immediately
- Test that duplicate requests are not created
- Test that existing approvals are returned immediately

**Files to modify:**
- `src/tools/event-approval-callback.ts` - Update requestApproval method
- `src/tools/approval-types.ts` - Add ApprovalPendingError export
- `src/tools/event-approval-callback.test.ts` - Update tests for new behavior

### Phase 3: Update Tool Executor for Pending Approvals

#### Task 3.1: Handle ApprovalPendingError in ToolExecutor
**File:** `src/tools/executor.ts` (lines ~128-154)

**Current code blocks on approval:**
```typescript
try {
  const approval = await this.approvalCallback.requestApproval(call.name, call.arguments);
  
  if (approval === ApprovalDecision.DENY) {
    return createErrorResult('Tool execution denied by approval policy', call.id);
  }
  
  // ALLOW_ONCE and ALLOW_SESSION both proceed to execution
} catch (error) {
  // Approval system failure
  return createErrorResult(
    error instanceof Error ? error.message : 'Approval system error',
    call.id
  );
}
```

**New code handles pending approvals:**
```typescript
try {
  const approval = await this.approvalCallback.requestApproval(call.name, call.arguments);
  
  if (approval === ApprovalDecision.DENY) {
    return createErrorResult('Tool execution denied by approval policy', call.id);
  }
  
  // ALLOW_ONCE and ALLOW_SESSION both proceed to execution
} catch (error) {
  // Check if this is a pending approval (not an error)
  if (error instanceof ApprovalPendingError) {
    // Tool approval is pending - don't execute yet
    // The Agent will execute this tool when approval response arrives
    return createPendingResult('Tool approval pending', call.id);
  }
  
  // Other approval system failures
  return createErrorResult(
    error instanceof Error ? error.message : 'Approval system error',
    call.id
  );
}
```

**Add new result type:**
```typescript
export function createPendingResult(message: string, toolCallId?: string): ToolResult {
  return {
    id: toolCallId,
    isError: false,
    isPending: true, // New field
    content: message,
  };
}
```

**Update ToolResult interface:**
```typescript
export interface ToolResult {
  id?: string;
  isError: boolean;
  isPending?: boolean; // New optional field
  content: string;
  metadata?: Record<string, unknown>;
}
```

**Testing:**
- Test that ApprovalPendingError creates pending result instead of error
- Test that pending results don't trigger further processing
- Test that other approval errors still create error results

**Files to modify:**
- `src/tools/executor.ts` - Update approval handling
- `src/tools/types.ts` - Update ToolResult interface and add createPendingResult
- `src/tools/executor.test.ts` - Add tests for pending approval handling

### Phase 4: Agent State Management Updates

#### Task 4.1: Update Agent to Handle Pending Tool Results
**File:** `src/agents/agent.ts`

**Update _executeSingleTool method:**
```typescript
private async _executeSingleTool(toolCall: ToolCall): Promise<void> {
  try {
    const workingDirectory = this._getWorkingDirectory();
    const toolContext = {
      threadId: asThreadId(this._threadId),
      parentThreadId: asThreadId(this._getParentThreadId()),
      workingDirectory,
    };
    
    const result = await this._toolExecutor.executeTool(toolCall, toolContext);
    
    // Only add TOOL_RESULT if not pending
    if (!result.isPending) {
      this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
    }
    // If pending, the approval system will handle execution later
    
  } catch (error) {
    // ... error handling unchanged ...
  }
}
```

**Testing:**
- Test that pending tool results don't create TOOL_RESULT events
- Test that only completed tool executions create TOOL_RESULT events
- Test that Agent state remains consistent with pending tools

### Phase 5: Integration Testing

#### Task 5.1: End-to-End Parallel Approval Test
**File:** `src/agents/parallel-approval.integration.test.ts` (NEW)

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { ApprovalDecision } from '~/tools/approval-types';
import { BashTool } from '~/tools/implementations/bash';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Test provider that returns multiple tool calls
class MultiToolProvider extends TestProvider {
  async createResponse(): Promise<ProviderResponse> {
    return {
      content: 'I will run multiple commands.',
      toolCalls: [
        { id: 'call_1', name: 'bash', input: { command: 'ls' } },
        { id: 'call_2', name: 'bash', input: { command: 'pwd' } },
        { id: 'call_3', name: 'bash', input: { command: 'date' } },
      ],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: 'end_turn',
    };
  }
}

describe('Agent Parallel Tool Approval Integration', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: MultiToolProvider;

  beforeEach(() => {
    setupTestPersistence();
    threadManager = new ThreadManager();
    provider = new MultiToolProvider();
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerTool('bash', new BashTool());

    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [new BashTool()],
    });

    const approvalCallback = new EventApprovalCallback(agent, threadManager, threadId);
    agent.toolExecutor.setApprovalCallback(approvalCallback);
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should fire all approval requests immediately for multiple tool calls', async () => {
    // Send message that triggers multiple tool calls
    const conversationPromise = agent.sendMessage('Please run ls, pwd, and date');

    // Wait for processing to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify all approval requests were created immediately
    const events = threadManager.getEvents(agent.threadId);
    const toolCalls = events.filter(e => e.type === 'TOOL_CALL');
    const approvalRequests = events.filter(e => e.type === 'TOOL_APPROVAL_REQUEST');
    
    expect(toolCalls).toHaveLength(3);
    expect(approvalRequests).toHaveLength(3);
    
    // Verify no tool results exist yet
    const toolResults = events.filter(e => e.type === 'TOOL_RESULT');
    expect(toolResults).toHaveLength(0);

    // Verify agent completed conversation and went idle
    expect(agent.getState()).toBe('idle');
    
    // Clean up
    await conversationPromise;
  });

  it('should execute tools individually as approvals are received', async () => {
    // Start conversation
    const conversationPromise = agent.sendMessage('Please run ls, pwd, and date');
    await new Promise(resolve => setTimeout(resolve, 100));

    // Approve second tool first (out of order)
    const response2Event = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_2',
      decision: ApprovalDecision.ALLOW_ONCE,
    });
    agent.emit('thread_event_added', { event: response2Event, threadId: agent.threadId });

    // Wait for execution
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify only tool 2 executed
    let events = threadManager.getEvents(agent.threadId);
    let toolResults = events.filter(e => e.type === 'TOOL_RESULT');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].id).toBe('call_2');

    // Approve first tool
    const response1Event = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_1',
      decision: ApprovalDecision.ALLOW_ONCE,
    });
    agent.emit('thread_event_added', { event: response1Event, threadId: agent.threadId });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify tool 1 executed
    events = threadManager.getEvents(agent.threadId);
    toolResults = events.filter(e => e.type === 'TOOL_RESULT');
    expect(toolResults).toHaveLength(2);

    // Deny third tool
    const response3Event = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_3',
      decision: ApprovalDecision.DENY,
    });
    agent.emit('thread_event_added', { event: response3Event, threadId: agent.threadId });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify tool 3 created error result
    events = threadManager.getEvents(agent.threadId);
    toolResults = events.filter(e => e.type === 'TOOL_RESULT');
    expect(toolResults).toHaveLength(3);
    
    const tool3Result = toolResults.find(r => r.id === 'call_3');
    expect(tool3Result.isError).toBe(true);

    await conversationPromise;
  });

  it('should handle multiple agents with pending approvals', async () => {
    // Create second agent
    const threadId2 = threadManager.generateThreadId();
    threadManager.createThread(threadId2);
    
    const agent2 = new Agent({
      provider: new MultiToolProvider(),
      toolExecutor: new ToolExecutor(),
      threadManager,
      threadId: threadId2,
      tools: [new BashTool()],
    });

    const approvalCallback2 = new EventApprovalCallback(agent2, threadManager, threadId2);
    agent2.toolExecutor.setApprovalCallback(approvalCallback2);

    // Both agents send messages
    const conv1Promise = agent.sendMessage('Agent 1: run commands');
    const conv2Promise = agent2.sendMessage('Agent 2: run commands');

    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify both agents created approval requests
    const events1 = threadManager.getEvents(agent.threadId);
    const events2 = threadManager.getEvents(agent2.threadId);
    
    const requests1 = events1.filter(e => e.type === 'TOOL_APPROVAL_REQUEST');
    const requests2 = events2.filter(e => e.type === 'TOOL_APPROVAL_REQUEST');
    
    expect(requests1).toHaveLength(3);
    expect(requests2).toHaveLength(3);

    // Both agents should be idle
    expect(agent.getState()).toBe('idle');
    expect(agent2.getState()).toBe('idle');

    await Promise.all([conv1Promise, conv2Promise]);
  });
});
```

**Testing approach:**
- ✅ Use real Agent, ThreadManager, ToolExecutor (no mocks of functionality under test)
- ✅ Test actual event flow and database persistence
- ✅ Verify timing and state transitions
- ✅ Test multiple agents scenario

### Phase 6: Update Existing Tests

#### Task 6.1: Fix EventApprovalCallback Tests
**File:** `src/tools/event-approval-callback.test.ts`

**Current tests expect blocking behavior - update to expect ApprovalPendingError:**

```typescript
it('should throw ApprovalPendingError when approval is needed', async () => {
  // Setup tool call event
  threadManager.addEvent(agent.threadId, 'TOOL_CALL', {
    id: 'call_test',
    name: 'bash',
    arguments: { command: 'ls' },
  });

  const approvalCallback = new EventApprovalCallback(agent, threadManager, agent.threadId);

  // Should throw pending error instead of blocking
  await expect(
    approvalCallback.requestApproval('bash', { command: 'ls' })
  ).rejects.toThrow(ApprovalPendingError);

  // Verify approval request was created
  const events = threadManager.getEvents(agent.threadId);
  const approvalRequest = events.find(e => e.type === 'TOOL_APPROVAL_REQUEST');
  expect(approvalRequest).toBeDefined();
});
```

#### Task 6.2: Update Agent Tests
**File:** `src/agents/agent.test.ts`

**Add tests for new non-blocking behavior:**

```typescript
it('should go idle immediately after processing tool calls', async () => {
  const mockProvider = new MockProviderWithToolCalls();
  mockProvider.setResponse({
    toolCalls: [
      { id: 'call_1', name: 'bash', input: { command: 'ls' } },
      { id: 'call_2', name: 'bash', input: { command: 'pwd' } },
    ],
  });

  const agent = new Agent({ /* ... */ });
  
  const conversationPromise = agent.sendMessage('Run commands');
  
  // Agent should complete conversation immediately
  await conversationPromise;
  expect(agent.getState()).toBe('idle');
  
  // Tool calls should be created but no results yet
  const events = threadManager.getEvents(agent.threadId);
  const toolCalls = events.filter(e => e.type === 'TOOL_CALL');
  const toolResults = events.filter(e => e.type === 'TOOL_RESULT');
  
  expect(toolCalls).toHaveLength(2);
  expect(toolResults).toHaveLength(0);
});
```

## TypeScript Guidelines

### No 'any' Types
Never use `any` type. Use proper TypeScript types:

```typescript
// ❌ Wrong
const data: any = event.data;

// ✅ Correct  
const data = event.data as ToolApprovalResponseData;

// ✅ Even better with type guard
function isToolApprovalResponse(event: ThreadEvent): event is ThreadEvent & { data: ToolApprovalResponseData } {
  return event.type === 'TOOL_APPROVAL_RESPONSE';
}

if (isToolApprovalResponse(event)) {
  // event.data is now properly typed
  const { toolCallId, decision } = event.data;
}
```

### Prefer unknown over any
```typescript
// ❌ Wrong
function parseJSON(input: string): any {
  return JSON.parse(input);
}

// ✅ Correct
function parseJSON(input: string): unknown {
  return JSON.parse(input);
}
```

### Use proper error types
```typescript
// ❌ Wrong
} catch (error) {
  console.log(error.message); // error is unknown
}

// ✅ Correct
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Operation failed', { message });
}
```

## Testing Guidelines

### Never Mock Functionality Under Test
```typescript
// ❌ Wrong - mocking the approval system we're testing
const mockApprovalCallback = {
  requestApproval: vi.fn().mockResolvedValue(ApprovalDecision.ALLOW_ONCE)
};

// ✅ Correct - test the real approval system
const approvalCallback = new EventApprovalCallback(agent, threadManager, threadId);
agent.toolExecutor.setApprovalCallback(approvalCallback);
```

### Use Real Code Paths
```typescript
// ❌ Wrong - mocking database
const mockThreadManager = {
  addEvent: vi.fn(),
  getEvents: vi.fn().mockReturnValue([])
};

// ✅ Correct - use real database with test setup
beforeEach(() => {
  setupTestPersistence(); // Creates real SQLite database
  threadManager = new ThreadManager(); // Real instance
});

afterEach(() => {
  teardownTestPersistence(); // Cleans up database
});
```

### Test-Driven Development (TDD)
1. **Write failing test first**
2. **Make test pass with minimal code**  
3. **Refactor while keeping tests green**

```typescript
// Step 1: Write failing test
it('should fire approval requests immediately', async () => {
  // This test will fail until implementation exists
  expect(agent.getState()).toBe('idle');
});

// Step 2: Implement just enough to pass
private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
  // Minimal implementation
  this._setState('idle');
}

// Step 3: Refactor with full implementation
```

### Commit Frequently
Make small, focused commits with clear messages:

```bash
git commit -m "feat: make Agent._executeToolCalls non-blocking

- Remove await from tool execution loop
- Agent goes idle immediately after tool calls
- Tool execution will be triggered by approval events

Tests verify Agent state and event creation."
```

## Files Reference

### Core Agent Files
- `src/agents/agent.ts` - Main Agent implementation
- `src/agents/agent.test.ts` - Agent unit tests

### Tool System Files  
- `src/tools/executor.ts` - ToolExecutor that handles approvals
- `src/tools/event-approval-callback.ts` - Event-based approval system
- `src/tools/approval-types.ts` - Approval interfaces and types
- `src/tools/types.ts` - Tool result types and utilities

### Thread Management Files
- `src/threads/thread-manager.ts` - Event storage and queries
- `src/threads/types.ts` - Event type definitions

### Test Utilities
- `src/test-utils/persistence-helper.ts` - Database setup/teardown
- `src/test-utils/test-provider.ts` - Mock LLM provider

## Success Criteria

### User Experience
- ✅ User sees all approval requests immediately when LLM returns multiple tool calls
- ✅ User can approve tools in any order
- ✅ Tools execute as soon as approved (no waiting for other approvals)
- ✅ Multiple agents can have pending approvals simultaneously
- ✅ When all tools approved: conversation continues automatically
- ✅ When any tools rejected: agent waits for user input before continuing

### Technical Requirements  
- ✅ Agent never blocks on tool execution
- ✅ No in-memory Promise state that can be lost
- ✅ Process restart doesn't break pending tool executions
- ✅ All state persisted in database events
- ✅ Event-driven execution triggered by approval responses
- ✅ Simple completion tracking: counter + boolean flag (no complex state machines)
- ✅ User rejections create error TOOL_RESULT events immediately
- ✅ Provider contract compliance: complete tool results before conversation continues

### Testing Requirements
- ✅ All tests use real code paths (no mocking functionality under test)
- ✅ Integration tests verify end-to-end approval flow
- ✅ Tests cover parallel approval scenarios
- ✅ Tests verify process-safe behavior

This architecture provides a foundation for robust, scalable tool execution that works reliably in multiprocess environments while providing excellent user experience for approval workflows.