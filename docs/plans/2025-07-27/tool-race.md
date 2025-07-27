# Tool Approval Race Condition Fix - Implementation Plan

**Date:** 2025-07-27  
**Status:** Ready for Implementation  
**Author:** Claude & Jesse  
**Priority:** Critical - Production Safety Issue

## Problem Statement

The tool approval system has a dangerous race condition that allows duplicate tool execution. Users can rapidly click approval buttons or network retries can create multiple `TOOL_APPROVAL_RESPONSE` events for the same tool call, causing tools to execute multiple times.

**Impact:** This can cause duplicate file writes, multiple API calls, database corruption, and other dangerous side effects.

**Evidence:** Production logs show duplicate approval responses for the same `toolCallId` occurring 2ms apart, causing Anthropic API errors: "each tool_use must have a single result. Found multiple tool_result blocks with id: toolu_01Tmw3q38djbBdRo1k81kegC"

## Architecture Overview

**Current Vulnerable Flow:**
```
User clicks → API Request → ThreadManager.addEvent() → Tool executes
User clicks → API Request → ThreadManager.addEvent() → Tool executes (DUPLICATE!)
```

**Fixed Flow with Race Prevention:**
```
User clicks → API Request → Database constraint prevents duplicate → Tool executes once
User clicks → API Request → Constraint violation → Returns success (idempotent)
```

## Solution Strategy

**Defense-in-Depth Approach:**
1. **Database Layer:** Unique constraints prevent duplicate approval events at storage level
2. **API Layer:** Atomic operations and proper error handling for constraint violations  
3. **Business Logic Layer:** Agent guards prevent duplicate execution even if events exist
4. **Presentation Layer:** Conversation deduplication ensures clean provider API calls

## Technology Context

**Database:** SQLite with better-sqlite3 driver  
**TypeScript:** Strict mode, never use `any` types  
**Testing:** Vitest framework, real components (no mocking functionality under test)  
**Architecture:** Event-sourcing with immutable event sequences  

**Key Files in Codebase:**
- `src/persistence/database.ts` - SQLite database operations and schema
- `src/threads/thread-manager.ts` - Event creation and thread management  
- `packages/web/app/api/threads/[threadId]/approvals/[toolCallId]/route.ts` - Approval API endpoint
- `src/agents/agent.ts` - Tool execution coordination
- `src/threads/conversation-builder.ts` - Converts events to provider API format

## Implementation Tasks

### Task 1: Add Database Unique Constraint

**Objective:** Prevent duplicate `TOOL_APPROVAL_RESPONSE` events at the database level.

**Files to Modify:**
- `src/persistence/database.ts`

**Background:** 
The `events` table stores all thread events including approval responses. Each event has:
- `thread_id` (string)  
- `type` (string like 'TOOL_APPROVAL_RESPONSE')
- `data` (JSON containing `toolCallId` for approval events)

**Implementation Steps:**

1. **Add the unique constraint to schema initialization:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tool_approval
ON events(thread_id, type, json_extract(data, '$.toolCallId'))  
WHERE type = 'TOOL_APPROVAL_RESPONSE';
```

2. **Find the schema initialization code** in `src/persistence/database.ts` and add this constraint after the existing table creation.

3. **Create a database migration function** to handle existing databases:
```typescript
private migrateToV11(): void {
  // Add unique constraint for tool approval responses
  this.database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tool_approval
    ON events(thread_id, type, json_extract(data, '$.toolCallId'))  
    WHERE type = 'TOOL_APPROVAL_RESPONSE';
  `);
  
  this.database.exec("PRAGMA user_version = 11;");
}
```

4. **Update the migration logic** to call `migrateToV11()` when appropriate.

**Testing:**
```typescript
// In src/persistence/database.test.ts
describe('unique constraint for tool approvals', () => {
  it('should prevent duplicate TOOL_APPROVAL_RESPONSE events', () => {
    const persistence = getPersistence();
    const threadId = 'test-thread';
    
    // Create first approval event
    const event1: ThreadEvent = {
      id: 'evt1',
      threadId,
      type: 'TOOL_APPROVAL_RESPONSE',
      timestamp: new Date(),
      data: { toolCallId: 'tool-123', decision: 'approve' }
    };
    
    // Should succeed
    expect(() => persistence.saveEvent(event1)).not.toThrow();
    
    // Create duplicate approval event  
    const event2: ThreadEvent = {
      id: 'evt2', 
      threadId,
      type: 'TOOL_APPROVAL_RESPONSE',
      timestamp: new Date(),
      data: { toolCallId: 'tool-123', decision: 'approve' }
    };
    
    // Should throw constraint violation
    expect(() => persistence.saveEvent(event2)).toThrow(/UNIQUE constraint failed/);
  });
});
```

**Commit Message:** `feat: add database unique constraint for tool approval responses`

### Task 2: Make ThreadManager.addEvent() Atomic

**Objective:** Ensure event creation is atomic - either the database write succeeds and memory is updated, or both fail together.

**Files to Modify:**
- `src/threads/thread-manager.ts`

**Background:** 
Currently `addEvent()` updates in-memory thread state and then tries to save to database. If the database save fails, the memory state becomes inconsistent.

**Current Method Signature:**
```typescript
addEvent(
  threadId: string,
  type: EventType,
  eventData: string | ToolCall | ToolResult | CompactionData | Record<string, unknown>
): ThreadEvent
```

**Implementation Steps:**

1. **Locate the `addEvent()` method** in `ThreadManager` class.

2. **Wrap the entire operation in a database transaction:**
```typescript
addEvent(
  threadId: string,
  type: EventType,
  eventData: string | ToolCall | ToolResult | CompactionData | Record<string, unknown>
): ThreadEvent {
  const thread = this.getThread(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const event: ThreadEvent = {
    id: generateEventId(),
    threadId,
    type,
    timestamp: new Date(),
    data: eventData,
  };

  // Use database transaction for atomicity
  return this._persistence.transaction(() => {
    // Save to database first
    this._persistence.saveEvent(event);
    
    // Only update memory if database save succeeded
    thread.events.push(event);
    thread.updatedAt = new Date();
    
    // Update process-local cache
    processLocalThreadCache.set(threadId, thread);
    
    return event;
  });
}
```

3. **Add the transaction method to DatabasePersistence** if it doesn't exist:
```typescript
// In src/persistence/database.ts
transaction<T>(fn: () => T): T {
  if (!this.database) {
    throw new Error('Database not initialized');
  }
  
  return this.database.transaction(fn)();
}
```

**Testing:**
```typescript
// In src/threads/thread-manager.test.ts
describe('addEvent atomicity', () => {
  it('should not update memory if database save fails', () => {
    const manager = new ThreadManager();
    const threadId = manager.createThread();
    
    // Mock database to fail on second save
    const mockPersistence = vi.spyOn(manager['_persistence'], 'saveEvent');
    mockPersistence.mockImplementationOnce(() => {}); // First call succeeds
    mockPersistence.mockImplementationOnce(() => {
      throw new Error('Database error');
    });
    
    // First event should succeed
    manager.addEvent(threadId, 'USER_MESSAGE', 'hello');
    expect(manager.getEvents(threadId)).toHaveLength(1);
    
    // Second event should fail and not affect memory
    expect(() => {
      manager.addEvent(threadId, 'USER_MESSAGE', 'world');
    }).toThrow('Database error');
    
    // Memory should still have only first event
    expect(manager.getEvents(threadId)).toHaveLength(1);
  });
});
```

**Commit Message:** `feat: make ThreadManager.addEvent() atomic with database transactions`

### Task 3: Update Approval API Error Handling

**Objective:** Make the approval API endpoint idempotent by gracefully handling constraint violations.

**Files to Modify:**
- `packages/web/app/api/threads/[threadId]/approvals/[toolCallId]/route.ts`

**Background:**
This API endpoint receives POST requests when users approve/deny tools. Currently it bypasses the Agent and calls `ThreadManager.addEvent()` directly, which violates our architecture. The web layer should only communicate with the Agent interface.

**ARCHITECTURAL FIX REQUIRED:** The web API must go through the Agent, not directly access ThreadManager.

**Implementation Steps:**

1. **Add handleApprovalResponse method to Agent class** to encapsulate approval logic:
```typescript
// In src/agents/agent.ts
async handleApprovalResponse(toolCallId: string, decision: string): Promise<void> {
  try {
    // Create approval response event with atomic database transaction
    const event = this._threadManager.addEvent(this._threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId,
      decision,
    });
    
    // Emit event for UI synchronization
    this.emit('thread_event_added', { event, threadId: this._threadId });
    
  } catch (error: unknown) {
    // Handle constraint violations gracefully
    if (error instanceof Error && 
        (error.message.includes('UNIQUE constraint failed') ||
         error.message.includes('SQLITE_CONSTRAINT_UNIQUE'))) {
      
      // Duplicate approval - log but don't throw (idempotent behavior)
      logger.warn('AGENT: Duplicate approval response ignored', {
        threadId: this._threadId,
        toolCallId,
        reason: 'Database constraint violation'
      });
      return;
    }
    
    // Re-throw other errors
    throw error;
  }
}
```

2. **Update the API route to use Agent interface:**
```typescript
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string; toolCallId: string }> }
): Promise<NextResponse> {
  try {
    const { threadId, toolCallId } = await params;
    const { decision } = await request.json() as { decision: string };
    
    // Get agent through proper service layer
    const sessionService = getSessionService();
    const sessionIdStr = threadId.includes('.') 
      ? threadId.split('.')[0] ?? threadId 
      : threadId;
    
    const session = await sessionService.getSession(asThreadId(sessionIdStr));
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    const agent = session.getAgent(asThreadId(threadId));
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found for thread' }, { status: 404 });
    }
    
    // Use Agent interface - no direct ThreadManager access
    await agent.handleApprovalResponse(toolCallId, decision);
    
    return NextResponse.json({ success: true });
    
  } catch (error: unknown) {
    logger.error('Approval API error', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Testing:**
```typescript
// In packages/web/app/api/threads/approval-concurrency.test.ts
describe('approval API concurrency', () => {
  it('should handle duplicate approval requests gracefully', async () => {
    const threadId = 'test-thread';
    const toolCallId = 'tool-123';
    
    // Create concurrent approval requests
    const request1 = fetch(`/api/threads/${threadId}/approvals/${toolCallId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' })
    });
    
    const request2 = fetch(`/api/threads/${threadId}/approvals/${toolCallId}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' })
    });
    
    // Both should return success
    const [response1, response2] = await Promise.all([request1, request2]);
    
    expect(response1.ok).toBe(true);
    expect(response2.ok).toBe(true);
    
    // But only one approval event should exist in database
    const threadManager = new ThreadManager();
    const events = threadManager.getEvents(threadId);
    const approvalEvents = events.filter(e => 
      e.type === 'TOOL_APPROVAL_RESPONSE' && 
      (e.data as { toolCallId: string }).toolCallId === toolCallId
    );
    
    expect(approvalEvents).toHaveLength(1);
  });
});
```

**Commit Message:** `fix: make approval API use proper Agent interface instead of direct ThreadManager access`

**REFACTORING NOTES:** 

1. **Database Error Handling:** The current implementation has SQLite constraint error handling in the Agent layer, but this violates separation of concerns. The persistence layer should handle database-specific errors and make operations idempotent at the database level. This should be refactored in a future task:

```typescript
// FUTURE: Move constraint error handling to DatabasePersistence.saveEvent()
saveEvent(event: ThreadEvent): void {
  try {
    // Attempt to save event
    this.db.prepare(insertQuery).run(...);
  } catch (error: unknown) {
    if (isConstraintViolation(error) && event.type === 'TOOL_APPROVAL_RESPONSE') {
      // Silently ignore duplicate approval responses - idempotent behavior
      logger.debug('Duplicate approval response ignored', { eventId: event.id });
      return;
    }
    throw error; // Re-throw other errors
  }
}
```

2. **Approval System Architecture Fix:** The current EventApprovalCallback has a fundamental design flaw - it requests approval by `toolName + input` and then tries to "find" which ToolCall this refers to by matching. This is backwards! We already have the ToolCall with a unique ID from the LLM. The approval system should work directly with ToolCall IDs:

**Current (Broken):**
```typescript
interface ApprovalCallback {
  requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision>;
}
// Then complex logic to find which ToolCall this refers to
```

**Fixed:**
```typescript
interface ApprovalCallback {
  requestApproval(toolCallId: string): Promise<ApprovalDecision>;
}
// Direct reference to the specific ToolCall ID
```

This eliminates all the complex `findRecentToolCallEvent` logic and race conditions around matching tool names and inputs. The ToolExecutor should pass the ToolCall ID directly to the approval system.

### Task 3.5: Fix Approval System Architecture (CRITICAL)

**Objective:** Fix the fundamental design flaw where approvals are requested by toolName+input instead of toolCallId.

**Files to Modify:**
- `src/tools/approval-types.ts`
- `src/tools/event-approval-callback.ts`  
- `src/tools/executor.ts`
- `packages/web/lib/server/agent-utils.ts`

**Background:**
The current approval system is backwards. When the Agent gets a ToolCall from the LLM, it has a unique ID. But the approval system throws away this ID and tries to "find" the right ToolCall by matching name and input. This is error-prone and creates unnecessary complexity.

**Implementation Steps:**

1. **Update ApprovalCallback interface:**
```typescript
// In src/tools/approval-types.ts
export interface ApprovalCallback {
  requestApproval(toolCallId: string): Promise<ApprovalDecision>;
}
```

2. **Simplify EventApprovalCallback:**
```typescript
// In src/tools/event-approval-callback.ts
export class EventApprovalCallback implements ApprovalCallback {
  constructor(private agent: Agent) {}
  
  requestApproval(toolCallId: string): Promise<ApprovalDecision> {
    // Check if approval response already exists (recovery case)
    const existingResponse = this.agent.checkExistingApprovalResponse(toolCallId);
    if (existingResponse) {
      return Promise.resolve(existingResponse);
    }

    // Check if approval request already exists to avoid duplicates
    const existingRequest = this.agent.checkExistingApprovalRequest(toolCallId);
    if (!existingRequest) {
      // Create TOOL_APPROVAL_REQUEST event
      this.agent.addApprovalRequestEvent(toolCallId);
    }

    // Return pending error - Agent will handle by not executing tool yet
    return Promise.reject(new ApprovalPendingError(toolCallId));
  }
}
```

3. **Update ToolExecutor to pass toolCallId:**
```typescript
// In src/tools/executor.ts - update executeTool method
async executeTool(toolCall: ToolCall, context?: ToolContext): Promise<ToolResult> {
  // ... existing validation logic ...
  
  if (this._approvalCallback) {
    try {
      // Pass the toolCall ID directly instead of name+input
      const decision = await this._approvalCallback.requestApproval(toolCall.id);
      if (decision === ApprovalDecision.DENY) {
        return this.createDeniedResult(toolCall.id);
      }
    } catch (error) {
      if (error instanceof ApprovalPendingError) {
        throw error; // Let Agent handle pending approvals
      }
      throw error;
    }
  }
  
  // ... rest of execution logic ...
}
```

4. **Remove complex event matching logic:**
All the `findRecentToolCallEvent`, `isDeepStrictEqual` matching logic can be deleted. The system works directly with known ToolCall IDs.

5. **Update agent-utils.ts:**
```typescript
// In packages/web/lib/server/agent-utils.ts
export function setupAgentApprovals(agent: Agent, _sessionId: ThreadId): void {
  const approvalCallback = new EventApprovalCallback(agent);
  agent.toolExecutor.setApprovalCallback(approvalCallback);
}
```

**Benefits:**
- Eliminates race conditions from tool name/input matching
- Removes complex event searching logic
- Makes approval system more reliable and easier to understand
- Reduces coupling between approval system and ThreadManager
- Preparation for proper architectural boundaries

**Commit Message:** `refactor: fix approval system to use toolCallId instead of toolName+input matching`

### Task 4: Add Agent-Level Duplicate Execution Guards

**Objective:** Prevent duplicate tool execution at the agent level as defense-in-depth.

**Files to Modify:**
- `src/agents/agent.ts`

**Background:**
The Agent class has a `_handleToolApprovalResponse()` method that executes tools when approvals are received. We need to prevent execution if the tool has already been executed.

**Implementation Steps:**

1. **Locate the `_handleToolApprovalResponse()` method** in the Agent class.

2. **Add duplicate execution check:**
```typescript
private _handleToolApprovalResponse(event: ThreadEvent): void {
  if (event.type !== 'TOOL_APPROVAL_RESPONSE') return;

  const responseData = event.data as ToolApprovalResponseData;
  const { toolCallId, decision } = responseData;

  // Check if tool has already been executed (duplicate prevention)
  const events = this._threadManager.getEvents(this._threadId);
  const existingResult = events.find(e => 
    e.type === 'TOOL_RESULT' && 
    (e.data as ToolResult).id === toolCallId
  );
  
  if (existingResult) {
    logger.warn('AGENT: Prevented duplicate tool execution', {
      threadId: this._threadId,
      toolCallId,
      reason: 'TOOL_RESULT already exists'
    });
    return; // Early exit - don't execute again
  }

  // Find the corresponding TOOL_CALL event
  const toolCallEvent = events.find(
    (e) => e.type === 'TOOL_CALL' && (e.data as ToolCall).id === toolCallId
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
    this._hasRejectionsInBatch = true;
  } else {
    // Execute the approved tool
    void this._executeApprovedTool(toolCall);
    return; // Early return to avoid double decrementing
  }

  // Handle denied tool completion
  this._pendingToolCount--;
  if (this._pendingToolCount === 0) {
    this._handleBatchComplete();
  }
}
```

**Testing:**
```typescript
// In src/agents/agent.test.ts
describe('duplicate execution prevention', () => {
  it('should not execute tool if TOOL_RESULT already exists', async () => {
    const agent = new Agent(/* setup params */);
    
    // Create tool call event
    const toolCall: ToolCall = {
      id: 'tool-123',
      name: 'test-tool', 
      arguments: { test: 'data' }
    };
    
    agent.threadManager.addEvent(agent.threadId, 'TOOL_CALL', toolCall);
    
    // Create existing tool result
    const existingResult: ToolResult = {
      id: 'tool-123',
      content: [{ type: 'text', text: 'Already executed' }],
      isError: false
    };
    
    agent.threadManager.addEvent(agent.threadId, 'TOOL_RESULT', existingResult);
    
    // Mock tool executor to track calls
    const executeSpy = vi.spyOn(agent['_toolExecutor'], 'executeTool');
    
    // Send duplicate approval
    const approvalEvent = agent.threadManager.addEvent(
      agent.threadId, 
      'TOOL_APPROVAL_RESPONSE',
      { toolCallId: 'tool-123', decision: 'approve' }
    );
    
    agent.emit('thread_event_added', { 
      event: approvalEvent, 
      threadId: agent.threadId 
    });
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Tool executor should not have been called
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
```

**Commit Message:** `feat: add agent-level guards against duplicate tool execution`

### Task 5: Enhance Conversation Builder Deduplication

**Objective:** Ensure the conversation sent to AI providers never contains duplicate tool results.

**Files to Modify:**
- `src/threads/conversation-builder.ts`

**Background:**
The conversation builder converts thread events into the format expected by AI providers (like Anthropic). It needs bulletproof deduplication.

**Implementation Steps:**

1. **Locate the conversation building logic** that processes `TOOL_RESULT` events.

2. **Strengthen deduplication logic:**
```typescript
// In buildConversationFromEvents or similar function
function deduplicateToolResults(events: ThreadEvent[]): ThreadEvent[] {
  const seenToolResults = new Set<string>();
  const deduplicatedEvents: ThreadEvent[] = [];
  
  for (const event of events) {
    if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data as ToolResult;
      const toolCallId = toolResult.id;
      
      if (!toolCallId) {
        logger.warn('CONVERSATION_BUILDER: TOOL_RESULT missing id', {
          eventId: event.id,
          threadId: event.threadId
        });
        continue; // Skip results without IDs
      }
      
      if (seenToolResults.has(toolCallId)) {
        logger.warn('CONVERSATION_BUILDER: Duplicate TOOL_RESULT filtered', {
          toolCallId,
          eventId: event.id,
          threadId: event.threadId
        });
        continue; // Skip duplicate
      }
      
      seenToolResults.add(toolCallId);
    }
    
    deduplicatedEvents.push(event);
  }
  
  return deduplicatedEvents;
}
```

3. **Apply deduplication in the main conversation building function.**

**Testing:**
```typescript
// In src/threads/conversation-builder.test.ts
describe('tool result deduplication', () => {
  it('should remove duplicate TOOL_RESULT events', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'thread-1',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: 'tool-123', name: 'test', arguments: {} }
      },
      {
        id: 'evt2', 
        threadId: 'thread-1',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: { id: 'tool-123', content: [{ type: 'text', text: 'Result 1' }], isError: false }
      },
      {
        id: 'evt3',
        threadId: 'thread-1', 
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: { id: 'tool-123', content: [{ type: 'text', text: 'Result 2' }], isError: false }
      }
    ];
    
    const conversation = buildConversationFromEvents(events);
    
    // Should have tool call + only one tool result
    const toolResults = conversation.filter(msg => 
      msg.role === 'user' && msg.content.some(c => c.type === 'tool_result')
    );
    
    expect(toolResults).toHaveLength(1);
  });
});
```

**Commit Message:** `feat: strengthen conversation builder tool result deduplication`

### Task 6: Comprehensive Integration Testing

**Objective:** Create end-to-end tests that verify the race condition fixes work in realistic scenarios.

**Files to Create:**
- `src/agents/tool-approval-race-conditions.test.ts`
- `packages/web/app/api/threads/approval-concurrency.test.ts`

**Testing Principles:**
- **Use real components** - No mocking of the functionality under test
- **Test actual concurrency** - Use `Promise.all()` to create real race conditions
- **Verify end state** - Check final database/memory state, not implementation details
- **Use real database** - SQLite in-memory, not mocked persistence

**Core Test Cases:**

1. **Concurrent API Requests Test:**
```typescript
// In packages/web/app/api/threads/approval-concurrency.test.ts
describe('concurrent approval API requests', () => {
  it('should handle rapid button clicking safely', async () => {
    const threadId = 'test-thread';
    const toolCallId = 'tool-rapid-click';
    
    // Create thread and tool call event first
    const threadManager = new ThreadManager();
    threadManager.createThread(threadId);
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: toolCallId,
      name: 'test-tool',
      arguments: { action: 'test' }
    });
    
    // Simulate rapid clicking (10 concurrent requests)
    const requests = Array(10).fill(null).map(() => 
      fetch(`/api/threads/${threadId}/approvals/${toolCallId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' })
      })
    );
    
    // All requests should complete successfully
    const responses = await Promise.all(requests);
    responses.forEach(response => {
      expect(response.ok).toBe(true);
    });
    
    // But only one approval event should exist
    const events = threadManager.getEvents(threadId);
    const approvalCount = events.filter(e => 
      e.type === 'TOOL_APPROVAL_RESPONSE' &&
      (e.data as { toolCallId: string }).toolCallId === toolCallId
    ).length;
    
    expect(approvalCount).toBe(1);
  });
});
```

2. **End-to-End Agent Test:**
```typescript
// In src/agents/tool-approval-race-conditions.test.ts  
describe('agent tool execution race conditions', () => {
  it('should execute tool exactly once despite multiple approvals', async () => {
    // Create real agent with real thread manager
    const agent = new Agent({
      threadId: 'race-test',
      provider: mockProvider,
      model: 'test-model'
    });
    
    // Mock tool that tracks execution count
    let executionCount = 0;
    const mockTool = {
      name: 'counter-tool',
      execute: vi.fn(() => {
        executionCount++;
        return { 
          id: 'tool-counter',
          content: [{ type: 'text', text: `Executed ${executionCount} times` }],
          isError: false 
        };
      })
    };
    
    agent.toolExecutor.addTool(mockTool);
    
    // Simulate agent receiving tool call from LLM
    mockProvider.setResponse({
      toolCalls: [{ 
        id: 'tool-counter', 
        name: 'counter-tool', 
        input: {} 
      }]
    });
    
    const conversationPromise = agent.sendMessage('Use the counter tool');
    
    // Wait for approval request
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send multiple concurrent approvals  
    const approvals = Array(5).fill(null).map(() => 
      agent.threadManager.addEvent(
        agent.threadId,
        'TOOL_APPROVAL_RESPONSE', 
        { toolCallId: 'tool-counter', decision: 'approve' }
      )
    );
    
    // Emit all approval events concurrently
    approvals.forEach(event => {
      agent.emit('thread_event_added', { 
        event, 
        threadId: agent.threadId 
      });
    });
    
    await conversationPromise;
    
    // Tool should have been executed exactly once
    expect(executionCount).toBe(1);
    expect(mockTool.execute).toHaveBeenCalledTimes(1);
    
    // Verify only one TOOL_RESULT event exists
    const events = agent.threadManager.getEvents(agent.threadId);
    const toolResults = events.filter(e => e.type === 'TOOL_RESULT');
    expect(toolResults).toHaveLength(1);
  });
});
```

**Commit Message:** `test: add comprehensive race condition integration tests`

### Task 7: Documentation and Cleanup

**Objective:** Document the race condition fixes and clean up any temporary code.

**Files to Modify:**
- `CLAUDE.md` (if architecture changes need documenting)
- Add inline code comments

**Documentation Topics:**
1. **Why unique constraints are used**
2. **How atomic operations prevent races** 
3. **What happens when constraint violations occur**
4. **How to test concurrent approval scenarios**

**Example Documentation:**
```typescript
// In src/threads/thread-manager.ts
/**
 * Add an event to a thread with atomic database persistence.
 * 
 * This method is designed to prevent race conditions in tool approval
 * scenarios where multiple requests might try to create the same event
 * simultaneously (e.g., rapid button clicking).
 * 
 * The operation is atomic: either both the database write and memory
 * update succeed, or both fail. This ensures consistency between the
 * persistent and in-memory representations.
 * 
 * For TOOL_APPROVAL_RESPONSE events, a database unique constraint
 * prevents duplicate approvals for the same toolCallId, causing
 * this method to throw if a duplicate is attempted.
 */
addEvent(
  threadId: string,
  type: EventType, 
  eventData: string | ToolCall | ToolResult | CompactionData | Record<string, unknown>
): ThreadEvent {
  // Implementation...
}
```

**Commit Message:** `docs: document tool approval race condition prevention`

## Testing Strategy

### Unit Tests
- **Database constraint behavior** - Verify unique constraint prevents duplicates
- **Atomic operations** - Ensure memory/database consistency 
- **Error handling** - Test constraint violation scenarios
- **Agent guards** - Verify duplicate execution prevention

### Integration Tests  
- **API concurrency** - Simulate rapid button clicking
- **End-to-end workflows** - Real agent with concurrent approvals
- **Cross-layer validation** - Verify all defense layers work together

### Manual Testing
1. **Open browser dev tools, set slow network**
2. **Click approval button rapidly multiple times**  
3. **Verify only one tool execution occurs**
4. **Check database has only one approval event**
5. **Verify no duplicate tool results in conversation**

## Success Criteria

- ✅ Database constraint prevents duplicate approval events
- ✅ API returns success for duplicate requests (idempotent behavior)  
- ✅ Tools execute exactly once despite multiple approvals
- ✅ No race conditions under concurrent access
- ✅ All existing functionality continues to work
- ✅ Comprehensive test coverage for concurrency scenarios
- ✅ Production logs show no more duplicate tool execution errors

## Development Guidelines

### TypeScript Rules
- **Never use `any` types** - Use `unknown` with type guards if needed
- **Proper error handling** - Always check `error instanceof Error`
- **Type all parameters and return values**
- **Use discriminated unions for event types**

### Testing Rules  
- **Never mock functionality under test** - Use real components
- **Use real database operations** - SQLite in-memory, not mocked
- **Test actual concurrency** - `Promise.all()`, `setTimeout()`
- **Verify end state** - Check final state, not implementation details
- **Import real types** - Reference production interfaces in tests

### Code Quality
- **Follow existing codebase patterns**
- **Add comprehensive error logging with context**
- **Use existing logger system** - Never `console.log`
- **Write clear commit messages** explaining what and why

### Commit Strategy
Make frequent, small commits:
1. `feat: add database unique constraint for tool approval responses`
2. `feat: make ThreadManager.addEvent() atomic with database transactions`  
3. `fix: make approval API idempotent by handling constraint violations`
4. `feat: add agent-level guards against duplicate tool execution`
5. `feat: strengthen conversation builder tool result deduplication`
6. `test: add comprehensive race condition integration tests`
7. `docs: document tool approval race condition prevention`

This plan provides **defense-in-depth**: database constraints prevent the core problem, atomic operations ensure consistency, API handles edge cases gracefully, agent guards catch anything that slips through, and conversation deduplication ensures clean provider API calls.