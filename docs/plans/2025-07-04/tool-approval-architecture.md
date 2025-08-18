# Tool Approval Architecture in Lace

## Overview

The tool approval system in Lace provides a secure mechanism for users to approve or deny tool execution requests from the AI agent. This document describes the implementation details and data flow.

## Core Types

### 1. Tool Types (`src/tools/types.ts`)

```typescript
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  id?: string;
  content: ContentBlock[];
  isError: boolean;
  metadata?: Record<string, unknown>;
}
```

### 2. Approval Types (`src/tools/approval-types.ts`)

```typescript
enum ApprovalDecision {
  ALLOW_ONCE = 'allow_once',
  ALLOW_SESSION = 'allow_session',
  DENY = 'deny',
}

interface ApprovalCallback {
  requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision>;
}
```

### 3. Agent Events (`src/agents/agent.ts`)

The agent emits an `approval_request` event with the following structure:

```typescript
interface ApprovalRequestEvent {
  toolName: string;
  input: unknown;
  isReadOnly: boolean;
  requestId: string;
  resolve: (decision: ApprovalDecision) => void;
}
```

## Approval Flow

### 1. CLI Interface (`src/interfaces/terminal/terminal-interface.tsx`)

The `TerminalInterface` class implements `ApprovalCallback`:

```typescript
class TerminalInterface implements ApprovalCallback {
  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // 1. Get tool information for risk assessment
    const tool = this.agent.toolExecutor.getTool(toolName);
    const isReadOnly = tool?.annotations?.readOnlyHint ?? false;
    
    // 2. Generate unique request ID
    const requestId = generateRequestId();
    
    // 3. Create promise to wait for user decision
    const promise = new Promise<ApprovalDecision>((resolve) => {
      this.pendingApprovalRequests.set(requestId, resolve);
      
      // 4. Emit approval request event to agent
      this.agent.emit('approval_request', {
        toolName,
        input,
        isReadOnly,
        requestId,
        resolve: (decision: ApprovalDecision) => {
          this.pendingApprovalRequests.delete(requestId);
          resolve(decision);
        },
      });
    });
    
    return promise;
  }
}
```

### 2. Web Interface (`packages/web/lib/server/`)

#### ApprovalManager (`approval-manager.ts`)

Manages pending approvals with timeouts and session-wide approvals:

```typescript
class ApprovalManager {
  async requestApproval(
    threadId: ThreadId,
    sessionId: ThreadId,
    toolName: string,
    toolDescription: string | undefined,
    input: unknown,
    isReadOnly: boolean,
    timeoutMs: number = 30000
  ): Promise<ApprovalDecision> {
    // 1. Check if already approved for session
    if (sessionApproved?.has(toolName)) {
      return 'allow_session';
    }
    
    // 2. Create pending approval with timeout
    const requestId = randomUUID();
    
    // 3. Emit SSE event to client
    const event: SessionEvent = {
      type: 'TOOL_APPROVAL_REQUEST',
      threadId,
      timestamp: new Date().toISOString(),
      data: {
        requestId,
        toolName,
        toolDescription,
        isReadOnly,
        riskLevel: this.getRiskLevel(toolName, isReadOnly),
        input,
        timeout: Math.floor(timeoutMs / 1000)
      } as ToolApprovalRequestData
    };
    
    SSEManager.getInstance().broadcast(sessionId, event);
    
    // 4. Wait for client response or timeout
  }
}
```

#### SessionService (`session-service.ts`)

Handles agent events and coordinates with ApprovalManager:

```typescript
// Listen for tool approval requests from agent
agent.on('approval_request', async ({ toolName, input, isReadOnly, requestId, resolve }) => {
  const approvalManager = getApprovalManager();
  
  try {
    // Get tool description
    const tool = agent._toolExecutor?.getTool(toolName);
    const toolDescription = tool?.description;
    
    // Request approval through manager
    const decision = await approvalManager.requestApproval(
      threadId,
      sessionId,
      toolName,
      toolDescription,
      input,
      isReadOnly
    );
    
    resolve(decision);
  } catch (error) {
    // On timeout or error, deny the request
    resolve('deny');
  }
});
```

### 3. API Types (`packages/web/types/api.ts`)

```typescript
interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  toolDescription?: string;
  isReadOnly: boolean;
  riskLevel: 'safe' | 'moderate' | 'destructive';
  input: Record<string, unknown>;
  timeout?: number;
}

interface SessionEvent {
  type: 'TOOL_APPROVAL_REQUEST' | ...;
  threadId: ThreadId;
  timestamp: string;
  data: any;
}
```

## Data Flow Sequence

1. **Tool Execution Request**: Agent attempts to execute a tool
2. **Approval Check**: ToolExecutor checks if approval is needed
3. **Callback Invocation**: ToolExecutor calls `ApprovalCallback.requestApproval()`
4. **Event Emission**: Interface emits `approval_request` event to agent
5. **SSE Broadcast**: Web interface broadcasts event to client via SSE
6. **User Decision**: Client UI presents approval dialog to user
7. **Response Processing**: Client sends decision back to server
8. **Resolution**: ApprovalManager resolves the pending promise
9. **Tool Execution**: Based on decision, tool is executed or denied

## Risk Level Classification

The system classifies tools into three risk levels:

- **Safe**: Read-only operations, task management
- **Moderate**: File modifications (write, edit, insert)
- **Destructive**: System commands (bash), delegation

## Session-Wide Approvals

When a user selects "Allow for Session", the ApprovalManager:
1. Stores the tool name in a session-specific Set
2. Auto-approves future requests for that tool in the same session
3. Clears all approvals when the session ends

## Timeout Handling

- Default timeout: 30 seconds
- On timeout, the request is automatically denied
- Pending approvals are cleared when sessions end
- UI is notified of timeouts via LOCAL_SYSTEM_MESSAGE events