# Tool Call Architecture Fixes

**Date:** 2025-07-26  
**Status:** Implementation Complete - All Tests Passing  
**Author:** Claude & Jesse  
**Parent Plan:** `2025-07-24-parallel-tasks.md`

## Problem Statement

During implementation of the event-driven tool architecture, we made an architectural mistake that violates separation of concerns. The Agent currently creates TOOL_APPROVAL_REQUEST events directly, bypassing the approval system entirely. This breaks the intended design and causes integration tests to fail.

### Current Broken Flow
```
Agent.sendMessage()
↓
Agent._executeToolCalls() creates TOOL_CALL events
↓ 
Agent directly creates TOOL_APPROVAL_REQUEST events ❌ WRONG
↓
Agent goes idle
↓
TOOL_APPROVAL_RESPONSE events trigger tool execution
```

### Intended Correct Flow  
```
Agent.sendMessage()
↓
Agent._executeToolCalls() creates TOOL_CALL events
↓
Agent immediately tries to execute tools via ToolExecutor
↓
ToolExecutor calls EventApprovalCallback.requestApproval()
↓
EventApprovalCallback creates TOOL_APPROVAL_REQUEST events ✅ CORRECT
↓
EventApprovalCallback throws ApprovalPendingError
↓
ToolExecutor returns pending result
↓
Agent handles pending results (no TOOL_RESULT events yet)
↓
Agent goes idle
↓
TOOL_APPROVAL_RESPONSE events trigger actual tool execution
```

## Root Cause Analysis

### 1. **Violation of Separation of Concerns**
- **Agent's Responsibility**: Conversation flow and tool coordination
- **Approval System's Responsibility**: Approval workflow and policy enforcement
- **Problem**: Agent is doing approval system work

### 2. **Bypassed Architecture**
- EventApprovalCallback.requestApproval() is never called in normal flow
- Approval policies and logic are completely bypassed
- System becomes less flexible and testable

### 3. **Integration Test Failures**
- Tests expect approval requests to be created by EventApprovalCallback
- Tests assume tools are attempted immediately, triggering approval flow
- Current implementation skips this entire flow

## Architectural Principles to Restore

### **Separation of Concerns**
```typescript
// Agent: Orchestrates conversation and tool coordination
class Agent {
  private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
    // Create TOOL_CALL events
    // Attempt tool execution immediately
    // Handle results (including pending results)
  }
}

// Approval System: Handles approval workflow
class EventApprovalCallback {
  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // Create TOOL_APPROVAL_REQUEST events
    // Throw ApprovalPendingError for event-driven flow
  }
}

// Tool Executor: Coordinates between tools and approval
class ToolExecutor {
  async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    // Handle approval flow
    // Return pending results when approval needed
    // Execute tools when approved
  }
}
```

### **Event-Driven Flow Integrity**
- Tools should be **attempted immediately** when tool calls are created
- **ApprovalPendingError** should be the mechanism that prevents actual execution
- **EventApprovalCallback** should own the approval request creation process

## Implementation Plan

### **Phase 1: Restore Proper Agent Tool Execution Flow**

#### **Task 1.1: Remove Direct Approval Request Creation from Agent**
**File:** `src/agents/agent.ts`

**Current broken code in _executeToolCalls:**
```typescript
// Create approval request immediately  ❌ WRONG
const approvalRequestEvent = this._threadManager.addEvent(
  this._threadId,
  'TOOL_APPROVAL_REQUEST',
  {
    toolCallId: providerToolCall.id,
  }
);

// Emit approval request event for UI (SSE stream)
this.emit('thread_event_added', {
  event: approvalRequestEvent,
  threadId: this._threadId,
});
```

**Correct code:**
```typescript
// NO DIRECT APPROVAL REQUEST CREATION
// Tool execution attempt will trigger approval flow
```

#### **Task 1.2: Restore Immediate Tool Execution Attempts**
**File:** `src/agents/agent.ts`

**Update _executeToolCalls to attempt execution:**
```typescript
private _executeToolCalls(toolCalls: ProviderToolCall[]): void {
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
    
    // Emit tool call start event for UI
    this.emit('tool_call_start', {
      toolName: providerToolCall.name,
      input: providerToolCall.input,
      callId: providerToolCall.id,
    });
    
    // Attempt tool execution immediately
    // This will trigger approval flow and create approval requests
    void this._executeSingleTool(toolCall);
  }
  
  // Agent goes idle immediately - tool execution attempts are non-blocking
  this._setState('idle');
}
```

**Key Changes:**
- Remove direct TOOL_APPROVAL_REQUEST creation
- Add immediate `this._executeSingleTool(toolCall)` calls
- Keep non-blocking behavior (don't await)

#### **Task 1.3: Update Tool Batch Tracking Logic**
**File:** `src/agents/agent.ts`

**Current issue:** Batch tracking assumes approval responses trigger execution, but we need to handle both pending results and completed results.

**Update _executeSingleTool to handle pending results:**
```typescript
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

    // Handle different result types
    if (result.isPending) {
      // Tool approval is pending - don't add TOOL_RESULT event
      // Don't decrement pending count yet - wait for approval response
      return;
    }

    // Tool completed (success or error) - add result and update tracking
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);

    // Emit tool call complete event
    this.emit('tool_call_complete', {
      toolName: toolCall.name,
      result,
      callId: toolCall.id,
    });

    // Update batch tracking
    this._pendingToolCount--;
    if (result.isError) {
      this._hasRejectionsInBatch = true;
    }

    // Check if all tools are complete
    if (this._pendingToolCount === 0) {
      this._handleBatchComplete();
    }
  } catch (error: unknown) {
    // Handle execution errors
    logger.error('AGENT: Tool execution failed', {
      threadId: this._threadId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: error instanceof Error ? error.message : String(error),
    });

    const errorResult: ToolResult = {
      id: toolCall.id,
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    };
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);

    // Update batch tracking for errors
    this._pendingToolCount--;
    this._hasRejectionsInBatch = true;

    if (this._pendingToolCount === 0) {
      this._handleBatchComplete();
    }
  }
}

private _handleBatchComplete(): void {
  if (this._hasRejectionsInBatch) {
    // Has rejections - wait for user input
    this._setState('idle');
    // Don't auto-continue conversation
  } else {
    // All approved - auto-continue conversation
    this._completeTurn();
    this._setState('idle');
    void this._processConversation();
  }
}
```

#### **Task 1.4: Fix Approval Response Handler Logic**
**File:** `src/agents/agent.ts`

**Current issue:** The approval response handler needs to coordinate with the new immediate execution flow.

**Update _handleToolApprovalResponse:**
```typescript
private _handleToolApprovalResponse(event: ThreadEvent): void {
  if (event.type !== 'TOOL_APPROVAL_RESPONSE') return;

  const responseData = event.data as ToolApprovalResponseData;
  const { toolCallId, decision } = responseData;

  // Find the corresponding TOOL_CALL event
  const events = this._threadManager.getEvents(this._threadId);
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
    // Execute the approved tool (this time it should succeed)
    void this._executeSingleTool(toolCall);
    // Note: Don't decrement pending count here - _executeSingleTool will handle it
    return; // Early return to avoid double decrementing
  }

  // Handle denied tool completion
  this._pendingToolCount--;
  if (this._pendingToolCount === 0) {
    this._handleBatchComplete();
  }
}
```

### **Phase 2: Verify EventApprovalCallback Correctness**

#### **Task 2.1: Confirm EventApprovalCallback Implementation**
**File:** `src/tools/event-approval-callback.ts`

**Current implementation should be correct:**
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
    // Create TOOL_APPROVAL_REQUEST event and emit it immediately ✅ CORRECT
    const event = this.threadManager.addEvent(this.threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: toolCallId,
    });
    
    // Emit the event so the SSE stream delivers it to the frontend immediately
    this.agent.emit('thread_event_added', { event, threadId: this.threadId });
  }
  
  // Instead of blocking, throw an error that indicates approval is pending
  throw new ApprovalPendingError(toolCallId);
}
```

**Verification needed:**
- Ensure duplicate request prevention works correctly
- Verify existing approval recovery logic
- Test approval request creation and emission

### **Phase 3: Update Tests to Match Correct Architecture**

#### **Task 3.1: Fix Integration Test Expectations**
**File:** `src/tools/event-approval-callback.test.ts`

**Current failing tests need expectation updates:**

1. **"should create TOOL_APPROVAL_REQUEST when Agent executes tool requiring approval"**
   - Should pass once Agent attempts tool execution immediately
   - EventApprovalCallback.requestApproval() will be called
   - Approval requests will be created by EventApprovalCallback as expected

2. **"should handle multiple concurrent tool calls"**
   - Update comment about sequential processing (line 209)
   - Both approval requests should be created immediately when both tools are attempted
   - Test logic should expect parallel approval request creation

3. **"should recover from existing approvals in the thread"**
   - Should work correctly once proper flow is restored
   - EventApprovalCallback will check for existing approvals and not create duplicates

#### **Task 3.2: Add Tests for New Flow Scenarios**
**File:** `src/tools/event-approval-callback.test.ts`

**New test cases needed:**
```typescript
it('should handle immediate tool execution attempts with pending results', async () => {
  // Agent creates tool calls and immediately attempts execution
  mockProvider.setResponse({
    toolCalls: [{ id: 'call_immediate', name: 'bash', input: { command: 'test' } }],
  });

  const conversationPromise = agent.sendMessage('Run test command');
  await new Promise(resolve => setTimeout(resolve, 50));

  // Verify tool call was created
  const events = threadManager.getEvents(agent.threadId);
  const toolCall = events.find(e => e.type === 'TOOL_CALL');
  expect(toolCall).toBeDefined();

  // Verify approval request was created by EventApprovalCallback
  const approvalRequest = events.find(e => e.type === 'TOOL_APPROVAL_REQUEST');
  expect(approvalRequest).toBeDefined();

  // Verify no tool result exists yet (pending)
  const toolResult = events.find(e => e.type === 'TOOL_RESULT');
  expect(toolResult).toBeUndefined();

  // Approve and verify execution
  const responseEvent = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
    toolCallId: 'call_immediate',
    decision: ApprovalDecision.ALLOW_ONCE,
  });
  agent.emit('thread_event_added', { event: responseEvent, threadId: agent.threadId });

  await new Promise(resolve => setTimeout(resolve, 50));
  await conversationPromise;

  // Now tool result should exist
  const finalEvents = threadManager.getEvents(agent.threadId);
  const finalToolResult = finalEvents.find(e => e.type === 'TOOL_RESULT');
  expect(finalToolResult).toBeDefined();
});
```

### **Phase 4: Integration and Testing**

#### **Task 4.1: Comprehensive Flow Testing**
**File:** `src/agents/agent.integration.test.ts` (NEW)

Create comprehensive integration tests that verify the entire corrected flow:

```typescript
describe('Corrected Tool Execution Flow Integration', () => {
  it('should follow proper event-driven flow with immediate execution attempts', async () => {
    // 1. Agent processes tool calls
    // 2. Agent creates TOOL_CALL events
    // 3. Agent immediately attempts tool execution
    // 4. ToolExecutor calls EventApprovalCallback.requestApproval()
    // 5. EventApprovalCallback creates TOOL_APPROVAL_REQUEST events
    // 6. EventApprovalCallback throws ApprovalPendingError
    // 7. ToolExecutor returns pending result
    // 8. Agent handles pending result (no TOOL_RESULT event yet)
    // 9. Agent goes idle
    // 10. User approval triggers second execution attempt
    // 11. Tool executes successfully and creates TOOL_RESULT event
  });
});
```

#### **Task 4.2: Performance and Edge Case Testing**
- Test rapid approval responses
- Test concurrent tool execution attempts
- Test error handling in corrected flow
- Test recovery scenarios with existing approvals

## Success Criteria

### **Architecture Restored**
- ✅ Agent no longer creates TOOL_APPROVAL_REQUEST events directly
- ✅ EventApprovalCallback owns approval request creation
- ✅ Proper separation of concerns maintained
- ✅ Tools are attempted immediately when tool calls are created

### **Event Flow Integrity**
- ✅ TOOL_CALL events created by Agent
- ✅ Tool execution attempted immediately by Agent
- ✅ TOOL_APPROVAL_REQUEST events created by EventApprovalCallback
- ✅ ApprovalPendingError thrown to prevent immediate execution
- ✅ TOOL_APPROVAL_RESPONSE events trigger actual tool execution
- ✅ TOOL_RESULT events created when tools complete

### **Test Suite Success**
- ✅ All EventApprovalCallback integration tests pass
- ✅ All Agent event-driven tests continue to pass
- ✅ New integration tests verify corrected flow
- ✅ No regression in existing functionality

### **System Properties Maintained**
- ✅ Non-blocking Agent behavior preserved
- ✅ Parallel approval capability maintained
- ✅ Process-safe design unchanged
- ✅ Auto-continue logic works correctly

## Risk Mitigation

### **Potential Issues**
1. **Double Tool Execution**: Tool might be attempted twice (initially and after approval)
   - **Mitigation**: Ensure ToolExecutor handles duplicate attempts gracefully
   - **Solution**: Use tool call ID tracking to prevent duplicate execution

2. **Race Conditions**: Approval responses arriving before initial attempt completes
   - **Mitigation**: Proper event ordering and state management
   - **Solution**: Use pending tool tracking to handle timing issues

3. **Performance Impact**: Immediate execution attempts might add overhead
   - **Mitigation**: Measure performance impact
   - **Solution**: Optimize approval callback if needed

## Implementation Timeline

1. **Phase 1**: Restore proper Agent flow (2-3 hours)
2. **Phase 2**: Verify EventApprovalCallback (30 minutes)  
3. **Phase 3**: Update and fix tests (1-2 hours)
4. **Phase 4**: Integration testing (1 hour)

**Total Estimated Time**: 4-6 hours

## Phase 5: Architectural Improvement - Separate Permission and Execution

### **Issue: Semantic Confusion in executeTool Method**

The current corrected design has `ToolExecutor.executeTool()` being called twice with different purposes:
1. **First call**: Check permissions and create approval requests (doesn't execute)
2. **Second call**: Actually execute the tool (does execute)

This violates single responsibility principle and creates semantic confusion.

### **Task 5.1: Split Tool Permission and Execution**
**Files:** `src/tools/executor.ts`, `src/tools/types.ts`, `src/agents/agent.ts`

**Current Problematic API:**
```typescript
// Confusing: same method does different things based on context
async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult>
```

**New Clean API:**
```typescript
// Clear separation of concerns
async requestToolPermission(call: ToolCall, context?: ToolContext): Promise<'granted' | 'pending'>
async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult>
```

**Implementation Steps:**

#### **Step 5.1.1: Add requestToolPermission Method**
```typescript
// src/tools/executor.ts
async requestToolPermission(call: ToolCall, context?: ToolContext): Promise<'granted' | 'pending'> {
  // 1. Check if tool exists
  const tool = this.tools.get(call.name);
  if (!tool) {
    throw new Error(`Tool '${call.name}' not found`);
  }

  // 2. Check tool policy if session is available
  if (context?.session) {
    const policy = context.session.getToolPolicy(call.name);
    switch (policy) {
      case 'deny':
        throw new Error(`Tool '${call.name}' execution denied by policy`);
      case 'allow':
        return 'granted'; // Skip approval system
      case 'require-approval':
        break; // Fall through to approval system
    }
  }

  // 3. Check approval
  if (!this.approvalCallback) {
    throw new Error('Tool execution requires approval but no approval callback is configured');
  }

  try {
    await this.approvalCallback.requestApproval(call.name, call.arguments);
    return 'granted'; // Approval was granted immediately
  } catch (error) {
    if (error instanceof ApprovalPendingError) {
      return 'pending'; // Approval request was created, waiting for response
    }
    throw error; // Other approval system failures
  }
}
```

#### **Step 5.1.2: Simplify executeTool Method**
```typescript
// src/tools/executor.ts - executeTool now only executes
async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
  // 1. Check if tool exists
  const tool = this.tools.get(call.name);
  if (!tool) {
    return createErrorResult(`Tool '${call.name}' not found`, call.id);
  }

  // 2. Execute the tool directly (permissions already checked)
  return this.executeToolDirect(tool, call, context);
}
```

#### **Step 5.1.3: Update Agent Flow**
```typescript
// src/agents/agent.ts
private async _executeSingleTool(toolCall: ToolCall): Promise<void> {
  try {
    const workingDirectory = this._getWorkingDirectory();
    const toolContext = {
      threadId: asThreadId(this._threadId),
      parentThreadId: asThreadId(this._getParentThreadId()),
      workingDirectory,
    };

    // First: Check permission
    const permission = await this._toolExecutor.requestToolPermission(toolCall, toolContext);
    
    if (permission === 'granted') {
      // Execute immediately if allowed
      const result = await this._toolExecutor.executeTool(toolCall, toolContext);
      
      // Add result and update tracking
      this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
      this.emit('tool_call_complete', {
        toolName: toolCall.name,
        result,
        callId: toolCall.id,
      });

      // Update batch tracking
      this._pendingToolCount--;
      if (result.isError) {
        this._hasRejectionsInBatch = true;
      }

      if (this._pendingToolCount === 0) {
        this._handleBatchComplete();
      }
    } else {
      // Permission pending - approval request was created
      // Don't decrement pending count yet - wait for approval response
      return;
    }
    
  } catch (error: unknown) {
    // Handle permission/execution errors
    logger.error('AGENT: Tool execution failed', {
      threadId: this._threadId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: error instanceof Error ? error.message : String(error),
    });

    const errorResult: ToolResult = {
      id: toolCall.id,
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    };
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);

    // Update batch tracking for errors
    this._pendingToolCount--;
    this._hasRejectionsInBatch = true;

    if (this._pendingToolCount === 0) {
      this._handleBatchComplete();
    }
  }
}
```

#### **Step 5.1.4: Simplify Approval Response Handler**
```typescript
// src/agents/agent.ts
private _handleToolApprovalResponse(event: ThreadEvent): void {
  if (event.type !== 'TOOL_APPROVAL_RESPONSE') return;

  const responseData = event.data as ToolApprovalResponseData;
  const { toolCallId, decision } = responseData;

  // Find the corresponding TOOL_CALL event
  const events = this._threadManager.getEvents(this._threadId);
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
    // Execute the approved tool directly (permission already granted)
    void this._executeApprovedTool(toolCall);
    return; // Early return to avoid double decrementing
  }

  // Handle denied tool completion
  this._pendingToolCount--;
  if (this._pendingToolCount === 0) {
    this._handleBatchComplete();
  }
}

private async _executeApprovedTool(toolCall: ToolCall): Promise<void> {
  try {
    const workingDirectory = this._getWorkingDirectory();
    const toolContext = {
      threadId: asThreadId(this._threadId),
      parentThreadId: asThreadId(this._getParentThreadId()),
      workingDirectory,
    };

    // Execute directly (permission already granted)
    const result = await this._toolExecutor.executeTool(toolCall, toolContext);
    
    // Add result and update tracking
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', result);
    this.emit('tool_call_complete', {
      toolName: toolCall.name,
      result,
      callId: toolCall.id,
    });

    // Update batch tracking
    this._pendingToolCount--;
    if (result.isError) {
      this._hasRejectionsInBatch = true;
    }

    if (this._pendingToolCount === 0) {
      this._handleBatchComplete();
    }
    
  } catch (error: unknown) {
    // Handle execution errors
    logger.error('AGENT: Approved tool execution failed', {
      threadId: this._threadId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: error instanceof Error ? error.message : String(error),
    });

    const errorResult: ToolResult = {
      id: toolCall.id,
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    };
    this._addEventAndEmit(this._threadId, 'TOOL_RESULT', errorResult);

    // Update batch tracking for errors
    this._pendingToolCount--;
    this._hasRejectionsInBatch = true;

    if (this._pendingToolCount === 0) {
      this._handleBatchComplete();
    }
  }
}
```

### **Task 5.2: Remove Obsolete Types and Patterns**

#### **Step 5.2.1: Remove isPending from ToolResult**
```typescript
// src/tools/types.ts
export interface ToolResult {
  id?: string;
  content: ContentBlock[];
  isError: boolean;
  // Remove: isPending?: boolean; // No longer needed
  metadata?: Record<string, unknown>;
}

// Remove: createPendingResult function - no longer needed
```

#### **Step 5.2.2: Remove ApprovalPendingError Usage in ToolExecutor**
```typescript
// ApprovalPendingError still needed by EventApprovalCallback
// But ToolExecutor no longer catches it - requestToolPermission handles it
```

### **Benefits of This Refactor**

#### **Semantic Clarity**
- `requestToolPermission()` always checks permissions
- `executeTool()` always executes tools
- No dual-purpose methods

#### **Single Responsibility**
- Permission checking is separate from execution
- Each method has one clear purpose
- Easier to test and reason about

#### **Simplified Error Handling**
- Permission errors vs execution errors are distinct
- No need for `isPending` result type
- No need for dual-purpose error handling

#### **Better Architecture**
- Clear separation between permission and execution phases
- Agent flow is more explicit and understandable
- Approval system boundaries are cleaner

### **Updated Implementation Timeline**

1. **Phase 1**: Restore proper Agent flow (2-3 hours) ✅ **COMPLETE**
2. **Phase 2**: Verify EventApprovalCallback (30 minutes) ✅ **COMPLETE**
3. **Phase 3**: Update tests to match correct architecture (1-2 hours) 
4. **Phase 4**: Integration testing (1 hour)
5. **Phase 5**: Architectural improvement - separate permission/execution (2-3 hours)

**Total Estimated Time**: 6-9 hours

## Conclusion

This plan restores the intended architecture where:
- **Agent** orchestrates conversation and coordinates tool execution
- **EventApprovalCallback** owns the approval workflow and creates approval events  
- **ToolExecutor** provides clean separation between permission checking and tool execution

The final design eliminates semantic confusion, maintains all benefits of the event-driven architecture, and provides a much cleaner API that follows single responsibility principles.