# Callback-Free Approval Architecture

## Problem Statement

The current approval system suffers from circular dependencies and shared state
issues:

```
Agent → ToolExecutor → ApprovalCallback → Agent.addApprovalRequestEvent()
```

This creates:

- Callback sharing between agents
- Cross-thread approval contamination
- Complex state management
- Circular dependency issues

## Solution: Agent-Owned Approval Flow

**Philosophy**: Agent owns and orchestrates its entire tool execution pipeline.

## Architecture Overview

```
Agent Controls Everything:
┌─────────────────────────────────────────────────────┐
│ Agent                                               │
│ ├─ checkToolPolicy()                               │
│ ├─ createApprovalRequest()                         │
│ ├─ waitForApprovalDecision()                       │
│ └─ executeApprovedTool() ──► ToolExecutor.execute() │
└─────────────────────────────────────────────────────┘

ToolExecutor: Simple Tool Registry + Execution
┌─────────────────────────────────────────────────────┐
│ ToolExecutor                                        │
│ ├─ getTool(name)                                   │
│ ├─ registerTool(name, tool)                        │
│ └─ execute(toolCall, context) ──► Tool.execute()   │
└─────────────────────────────────────────────────────┘
```

## Implementation Design

### 1. Simplified ToolExecutor

```typescript
class ToolExecutor {
  private tools = new Map<string, Tool>();
  private session?: Session;

  // ONLY method needed - just execute tools
  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.getTool(toolCall.name);
    if (!tool) {
      throw new Error(`Tool '${toolCall.name}' not found`);
    }

    // Tool does its own validation and execution
    return tool.executeValidated(toolCall.arguments, context);
  }

  // Tool registry methods (unchanged)
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  registerTool(name: string, tool: Tool): void {
    this.tools.set(name, tool);
  }
  registerTools(tools: Tool[]): void {
    tools.forEach((t) => this.registerTool(t.name, t));
  }
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  // Session binding for policy lookups (unchanged)
  setSession(session: Session): void {
    this.session = session;
  }
  getSession(): Session | undefined {
    return this.session;
  }

  // MCP methods (unchanged)
  async registerMCPTools(mcpManager: MCPServerManager): Promise<void> {
    /* existing */
  }
}
```

### 2. Agent-Owned Approval Flow

```typescript
class Agent {
  // Main tool execution entry point
  private async _executeSingleTool(toolCall: ToolCall): Promise<void> {
    try {
      const toolContext = {
        agent: this,
        workingDirectory: this._getWorkingDirectory(),
        signal: this._getToolAbortSignal(),
      };

      // 1. Agent checks policy directly
      const permission = await this._checkToolPermission(toolCall);

      if (permission === 'granted') {
        // Execute immediately
        const result = await this._toolExecutor.execute(toolCall, toolContext);
        this._handleToolResult(toolCall.id, result);
      } else if (permission === 'approval_required') {
        // Agent orchestrates approval flow
        await this._handleToolApprovalFlow(toolCall, toolContext);
      } else {
        // Denied
        const deniedResult = this._createDeniedResult(toolCall, permission);
        this._handleToolResult(toolCall.id, deniedResult);
      }
    } catch (error) {
      this._handleToolError(toolCall.id, error);
    }
  }

  // Agent directly manages approval flow
  private async _handleToolApprovalFlow(
    toolCall: ToolCall,
    context: ToolContext
  ): Promise<void> {
    // 1. Create approval request event (in correct thread!)
    this._addEventAndEmit({
      type: 'TOOL_APPROVAL_REQUEST',
      data: { toolCallId: toolCall.id },
      context: {
        threadId: this._threadId, // Always correct thread!
        sessionId: this._getSessionId(),
      },
    });

    // 2. Wait for approval decision
    const decision = await this._waitForApprovalDecision(toolCall.id);

    // 3. Act on decision
    if (this._isApprovalGranted(decision)) {
      const result = await this._toolExecutor.execute(toolCall, context);
      this._handleToolResult(toolCall.id, result);
    } else {
      const deniedResult = this._createDeniedResult(toolCall, decision);
      this._handleToolResult(toolCall.id, deniedResult);
    }
  }

  // Policy checking (no external dependencies)
  private async _checkToolPermission(
    toolCall: ToolCall
  ): Promise<'granted' | 'approval_required' | 'denied'> {
    const session = await this.getFullSession();
    if (!session) return 'denied';

    const policy = session.getToolPolicy(toolCall.name);

    switch (policy) {
      case 'allow':
        return 'granted';
      case 'deny':
        return 'denied';
      case 'ask':
        return 'approval_required';
      default:
        return 'approval_required'; // Safe default
    }
  }

  // Wait for approval using existing event system
  private async _waitForApprovalDecision(
    toolCallId: string
  ): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        reject(new Error(`Approval timeout for tool call ${toolCallId}`));
      }, 300000); // 5 minutes

      // Listen for approval response event
      const checkForResponse = () => {
        const decision = this._threadManager.getApprovalDecision(toolCallId);
        if (decision) {
          clearTimeout(timeout);
          resolve(decision as ApprovalDecision);
        } else {
          // Check again in 100ms
          setTimeout(checkForResponse, 100);
        }
      };

      checkForResponse();
    });
  }

  // Public API for external approval submission (replaces callback)
  async handleApprovalResponse(
    toolCallId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    // Write response event to database
    this._addEventAndEmit({
      type: 'TOOL_APPROVAL_RESPONSE',
      data: { toolCallId, decision },
      context: {
        threadId: this._threadId,
        sessionId: this._getSessionId(),
      },
    });

    // The waiting tool execution will pick up this response and continue
  }
}
```

### 3. Session Approval Service (No Changes Needed!)

```typescript
// Existing session API works perfectly - just queries thread state
class SessionApprovalService {
  getSessionPendingApprovals(sessionId: ThreadId): PendingApproval[] {
    const threadIds = this.threadManager
      .getThreadsBySession(sessionId)
      .map((t) => t.id);

    // Same SQL query as before - reads thread state
    return this.db.query(
      `
      SELECT req.data->>'toolCallId', req.thread_id, tc.data, req.timestamp
      FROM events req
      JOIN events tc ON tc.data->>'id' = req.data->>'toolCallId'
      WHERE req.type = 'TOOL_APPROVAL_REQUEST'
        AND req.thread_id IN (${threadIds.map(() => '?').join(',')})
        AND NOT EXISTS (SELECT 1 FROM events resp WHERE ...)
    `,
      threadIds
    );
  }
}
```

### 4. Frontend (Minimal Changes)

```typescript
// ToolApprovalProvider stays session-scoped (no changes!)
// EventStreamProvider already handles session events (no changes!)

// Approval decisions still go to session endpoint
await api.post(`/api/sessions/${sessionId}/approvals/${toolCallId}`, {
  decision,
});
```

## Migration Benefits

1. ✅ **Zero database schema changes** - uses existing events table
2. ✅ **Zero frontend changes** - existing session-scoped UI works
3. ✅ **Eliminates circular dependencies** - clean one-way flow
4. ✅ **Eliminates callback sharing** - no callbacks exist
5. ✅ **Simplifies ToolExecutor** - remove 4 complex methods, add 1 simple
   method
6. ✅ **Fixes cross-thread bug** - approval events always created in correct
   thread

## What Gets Removed

**From ToolExecutor**:

- `executeTool()` (deprecated)
- `requestToolPermission()` (moves to Agent)
- `executeApprovedTool()` (becomes `execute()`)
- `setApprovalCallback()` (no callbacks)
- `getApprovalCallback()` (no callbacks)
- All approval state management

**From everywhere else**:

- `EventApprovalCallback` class (delete entire file)
- `setupAgentApprovals()` function (no callbacks to set up)
- All callback sharing logic in Session, SessionService

## Result

**ToolExecutor**: 80 lines → 30 lines (just tool registry + execute) **Agent**:
Gains clear approval orchestration methods **Zero sharing issues**: Impossible
to have callback contamination **Zero circular dependencies**: Agent →
ToolExecutor (one way)

This architecture is **fundamentally incapable** of having the cross-thread
approval bugs we've been fighting!

Want me to implement this clean architecture?
