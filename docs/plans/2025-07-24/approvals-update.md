# Tool Approval System Redesign

**Date:** 2025-07-24  
**Status:** Implementation Phase - Phase 3 COMPLETED ✅  
**Author:** Claude & Jesse  

## Executive Summary

The current web interface tool approval system is fundamentally broken due to storing JavaScript Promise resolvers in memory across NextJS multiprocess boundaries. This document outlines a complete redesign using immutable events and database-level queries that maintains architectural elegance while providing bulletproof persistence and recovery.

## Current System Problems

### Critical Architectural Flaws

1. **Process Isolation Failure**
   - Promise resolvers stored in `ApprovalManager` memory
   - NextJS dev server spawns multiple Node.js processes
   - API routes may execute in different process than approval request creation
   - Promise resolvers become inaccessible → approval requests stuck forever

2. **No Persistence**
   - All approval state lives in memory
   - Server restart loses all pending approvals
   - Browser refresh breaks approval UI with no recovery

3. **Single Approval Limitation**
   - Client stores only one approval request at a time
   - Multiple simultaneous requests overwrite each other
   - Only most recent approval visible to user

4. **Architecture Bypass**
   - Web implementation ignores existing core approval system
   - Duplicates functionality instead of integrating with `policy-wrapper.ts`
   - Creates custom `ApprovalManager` rather than using `Session.toolPolicies`

## Design Philosophy

### Core Principles

1. **Use Existing Infrastructure**: Leverage the event-sourcing ThreadManager system rather than creating parallel approval storage
2. **Database-Level Logic**: Handle approval state queries at the SQLite level, not in memory
3. **Immutable Events**: Maintain event-sourcing principles with append-only event streams
4. **No Data Duplication**: Reference existing TOOL_CALL events rather than duplicating tool metadata
5. **Process-Safe**: No in-memory state that breaks across process boundaries

### Why Events Over Tables

**Rejected Approach: Separate approval_state table**
```sql
CREATE TABLE approval_state (
  tool_call_id TEXT PRIMARY KEY,
  status TEXT,
  decision TEXT
);
```

**Why rejected:**
- Duplicates ThreadManager persistence logic
- Creates parallel storage system
- Violates YAGNI principle
- Requires additional migration/schema management

**Chosen Approach: Event-based storage**
- Uses existing SQLite persistence via ThreadManager
- Automatic durability and recovery
- Integrates with existing SSE event broadcasting
- No additional infrastructure needed

## New Design Architecture

### Event Types

Add two new immutable event types to the existing event system:

```typescript
export const EVENT_TYPES = [
  'USER_MESSAGE',
  'AGENT_MESSAGE',
  'TOOL_CALL',
  'TOOL_APPROVAL_REQUEST',  // ← New: Request user approval
  'TOOL_APPROVAL_RESPONSE', // ← New: User's approval decision  
  'TOOL_RESULT',
  'LOCAL_SYSTEM_MESSAGE',
  'SYSTEM_PROMPT', 
  'USER_SYSTEM_PROMPT',
  'COMPACTION',
] as const;
```

**Event Flow:**
```
TOOL_CALL → TOOL_APPROVAL_REQUEST → TOOL_APPROVAL_RESPONSE → TOOL_RESULT
```

### Event Data Schema

#### TOOL_APPROVAL_REQUEST
```typescript
{
  type: 'TOOL_APPROVAL_REQUEST',
  threadId: 'thread_123',
  timestamp: Date,
  data: {
    toolCallId: 'call_456'  // References existing TOOL_CALL event
  }
}
```

**Rationale:**
- Minimal data - no duplication of tool metadata
- References existing TOOL_CALL event via `toolCallId`
- All tool context (name, input, annotations) retrieved from TOOL_CALL

#### TOOL_APPROVAL_RESPONSE  
```typescript
{
  type: 'TOOL_APPROVAL_RESPONSE',
  threadId: 'thread_123', 
  timestamp: Date,
  data: {
    toolCallId: 'call_456',           // Links back to request
    decision: 'allow_once'            // ApprovalDecision enum value
  }
}
```

**Rationale:**
- Links to original TOOL_CALL via `toolCallId`
- Contains only the user's decision
- Immutable record of approval decision with timestamp

### Database Queries

#### Find Pending Approvals (Recovery Query)

```sql
-- Get all TOOL_CALLs that have approval requests but no responses
SELECT 
  req.data->>'toolCallId' as tool_call_id,
  tc.data as tool_call_data,
  req.timestamp as requested_at
FROM events req
JOIN events tc ON tc.data->>'id' = req.data->>'toolCallId'  
WHERE req.type = 'TOOL_APPROVAL_REQUEST'
  AND tc.type = 'TOOL_CALL'
  AND NOT EXISTS (
    SELECT 1 FROM events resp 
    WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
      AND resp.data->>'toolCallId' = req.data->>'toolCallId'
  )
ORDER BY req.timestamp ASC;
```

**Query Performance:**
```sql
-- Required index for efficient approval queries
CREATE INDEX idx_approval_tool_call_id 
ON events ((data->>'toolCallId')) 
WHERE type IN ('TOOL_APPROVAL_REQUEST', 'TOOL_APPROVAL_RESPONSE');

-- Additional index for TOOL_CALL lookups  
CREATE INDEX idx_tool_call_id
ON events ((data->>'id'))
WHERE type = 'TOOL_CALL';
```

#### Check Approval Status (Tool Execution)

```sql
-- Check if specific tool call has been approved
SELECT resp.data->>'decision' as decision
FROM events resp
WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
  AND resp.data->>'toolCallId' = ?
LIMIT 1;
```

## Implementation Plan

### Phase 1: Core Event System Updates

#### 1.1 Update Event Types ✅ COMPLETED
**File:** `src/threads/types.ts`

```typescript
export const EVENT_TYPES = [
  'USER_MESSAGE',
  'AGENT_MESSAGE', 
  'TOOL_CALL',
  'TOOL_APPROVAL_REQUEST',  // Add
  'TOOL_APPROVAL_RESPONSE', // Add
  'TOOL_RESULT',
  'LOCAL_SYSTEM_MESSAGE',
  'SYSTEM_PROMPT',
  'USER_SYSTEM_PROMPT', 
  'COMPACTION',
] as const;
```

**Test Coverage:** `src/threads/approval-events.test.ts` - validates new event types are properly included and typed.

#### 1.2 Database Migration ✅ COMPLETED
**File:** `src/persistence/database.ts` (migrateToV10 method)

**Added Indexes:**
```sql
-- Approval query optimization indexes
CREATE INDEX IF NOT EXISTS idx_approval_tool_call_id 
ON events ((data->>'toolCallId')) 
WHERE type IN ('TOOL_APPROVAL_REQUEST', 'TOOL_APPROVAL_RESPONSE');

CREATE INDEX IF NOT EXISTS idx_tool_call_id
ON events ((data->>'id'))
WHERE type = 'TOOL_CALL';
```

**Query Methods Added:**
- `getPendingApprovals(threadId)` - Returns all pending approvals for a thread
- `getApprovalDecision(toolCallId)` - Returns approval decision for specific tool call

**Test Coverage:** `src/threads/approval-queries.test.ts` - validates SQL queries and database methods work correctly with real SQLite data.

### Phase 2: Core Approval Logic

#### 2.1 Create Event-Based ApprovalCallback in Core ✅ COMPLETED
**File:** `src/tools/event-approval-callback.ts` (NEW)

```typescript
// ABOUTME: Event-based approval callback that uses ThreadManager for persistence
// ABOUTME: Replaces Promise-based approval system with durable event storage

import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types';
import { ThreadManager } from '~/threads/thread-manager';
import { Agent } from '~/agents/agent';
import { ToolCall } from '~/tools/types';

export class EventApprovalCallback implements ApprovalCallback {
  constructor(
    private agent: Agent,
    private threadManager: ThreadManager,
    private threadId: string
  ) {}

  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // Find the TOOL_CALL event that triggered this approval
    const toolCallEvent = this.findRecentToolCallEvent(toolName, input);
    if (!toolCallEvent) {
      throw new Error(`Could not find TOOL_CALL event for ${toolName}`);
    }
    
    // Create TOOL_APPROVAL_REQUEST event
    this.threadManager.addEvent(
      this.threadId,
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: toolCallEvent.data.id }
    );
    
    // Wait for TOOL_APPROVAL_RESPONSE event
    return this.waitForApprovalResponse(toolCallEvent.data.id);
  }

  private findRecentToolCallEvent(toolName: string, input: unknown): ThreadEvent | null {
    const events = this.threadManager.getEvents(this.threadId);
    
    // Find most recent TOOL_CALL for this tool with matching input
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.type === 'TOOL_CALL') {
        const toolCall = event.data as ToolCall;
        if (toolCall.name === toolName && 
            JSON.stringify(toolCall.arguments) === JSON.stringify(input)) {
          return event;
        }
      }
    }
    return null;
  }

  private waitForApprovalResponse(toolCallId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      // Check if response already exists (recovery case)
      const existingResponse = this.checkExistingApprovalResponse(toolCallId);
      if (existingResponse) {
        resolve(existingResponse);
        return;
      }

      // Listen for new events via ThreadManager
      const eventHandler = (event: ThreadEvent) => {
        if (event.type === 'TOOL_APPROVAL_RESPONSE' && 
            event.data.toolCallId === toolCallId) {
          this.threadManager.off('event_added', eventHandler);
          resolve(event.data.decision);
        }
      };
      
      this.threadManager.on('event_added', eventHandler);
    });
  }

  private checkExistingApprovalResponse(toolCallId: string): ApprovalDecision | null {
    const events = this.threadManager.getEvents(this.threadId);
    const responseEvent = events.find(e => 
      e.type === 'TOOL_APPROVAL_RESPONSE' && 
      e.data.toolCallId === toolCallId
    );
    return responseEvent?.data.decision || null;
  }
}
```

**Implementation Notes:**
- ✅ Core `EventApprovalCallback` class implemented with full TDD coverage
- ✅ Handles tool call matching by name and input arguments  
- ✅ Prevents duplicate TOOL_APPROVAL_REQUEST events
- ✅ Supports existing approval response recovery
- ✅ Uses polling approach (event emission to be added later)

**Test Coverage:** `src/tools/event-approval-callback.test.ts` - validates core approval logic with real ThreadManager and database.

#### 2.2 Add Approval Query Methods to ThreadManager ✅ COMPLETED
**File:** `src/threads/thread-manager.ts`

```typescript
/**
 * Get all pending tool approvals for a thread
 * Returns TOOL_CALLs that have approval requests but no responses
 */
getPendingApprovals(threadId: string): Array<{
  toolCallId: string;
  toolCall: ToolCall;
  requestedAt: Date;
}> {
  if (!this._persistence.database) return [];
  
  const query = `
    SELECT 
      req.data->>'toolCallId' as tool_call_id,
      tc.data as tool_call_data,
      req.timestamp as requested_at
    FROM events req
    JOIN events tc ON tc.data->>'id' = req.data->>'toolCallId'
    WHERE req.type = 'TOOL_APPROVAL_REQUEST'
      AND req.thread_id = ?
      AND tc.type = 'TOOL_CALL'  
      AND NOT EXISTS (
        SELECT 1 FROM events resp
        WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
          AND resp.data->>'toolCallId' = req.data->>'toolCallId'
      )
    ORDER BY req.timestamp ASC
  `;
  
  const results = this._persistence.database.prepare(query).all(threadId);
  
  return results.map(row => ({
    toolCallId: row.tool_call_id,
    toolCall: JSON.parse(row.tool_call_data),
    requestedAt: new Date(row.requested_at)
  }));
}

/**
 * Get approval decision for a specific tool call
 */
getApprovalDecision(toolCallId: string): ApprovalDecision | null {
  if (!this._persistence.database) return null;
  
  const query = `
    SELECT resp.data->>'decision' as decision
    FROM events resp
    WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
      AND resp.data->>'toolCallId' = ?
    LIMIT 1
  `;
  
  const result = this._persistence.database.prepare(query).get(toolCallId);
  return result?.decision || null;
}
```

#### 2.3 Update Web Agent Setup to Use Core Approval ✅ COMPLETED
**File:** `packages/web/lib/server/agent-utils.ts`

**Replaced entire file with:**
```typescript
// ABOUTME: Thin web integration layer for core approval system  
// ABOUTME: Sets up event-based approval callback from core tools system

import { Agent, EventApprovalCallback } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/core-types';

export function setupAgentApprovals(agent: Agent, _sessionId: ThreadId): void {
  // Use core event-based approval callback
  const approvalCallback = new EventApprovalCallback(
    agent,
    agent.threadManager,
    agent.threadId
  );
  
  // Set the approval callback on the agent's ToolExecutor
  agent.toolExecutor.setApprovalCallback(approvalCallback);
}
```

**Additional Implementation Notes:**
- ✅ Added EventApprovalCallback export to `packages/web/lib/server/lace-imports.ts`
- ✅ Added proper TypeScript types for approval events (`ToolApprovalRequestData`, `ToolApprovalResponseData`)
- ✅ Updated EventApprovalCallback with proper type casting for type safety
- ✅ All tests passing with complete web integration

#### 2.4 Remove Broken ApprovalManager
**Files to delete:**
- `packages/web/lib/server/approval-manager.ts` 
- `packages/web/lib/server/approval-manager.test.ts`

**Rationale:** This entire system is fundamentally broken and replaced by core event-based approach.

### Phase 3: Web Interface Updates

#### 3.1 Update API Routes (Thin Layer)
**Delete:** `packages/web/app/api/approvals/[requestId]/route.ts`

**Create:** `packages/web/app/api/threads/[threadId]/approvals/[toolCallId]/route.ts`

```typescript
// ABOUTME: Thin API layer that uses core ThreadManager for approval responses
// ABOUTME: Web-specific route that delegates to core event system

export async function POST(
  request: NextRequest,
  { params }: { params: { threadId: string; toolCallId: string } }
) {
  const { threadId, toolCallId } = await params;
  const { decision } = await request.json();
  
  // Delegate to core ThreadManager (no web-specific logic)
  const sessionService = getSessionService();
  const agent = sessionService.getAgent(threadId);
  
  // Use core ThreadManager to create approval response event
  agent.threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
    toolCallId,
    decision
  });
  
  return NextResponse.json({ success: true });
}
```

**Create:** `packages/web/app/api/threads/[threadId]/approvals/pending/route.ts`

```typescript
// ABOUTME: Recovery API that uses core ThreadManager query methods
// ABOUTME: Thin web layer over core approval system

export async function GET(
  request: NextRequest, 
  { params }: { params: { threadId: string } }
) {
  const { threadId } = await params;
  
  // Delegate to core ThreadManager query method
  const sessionService = getSessionService(); 
  const agent = sessionService.getAgent(threadId);
  
  // Use core method to get pending approvals
  const pendingApprovals = agent.threadManager.getPendingApprovals(threadId);
  
  return NextResponse.json({ pendingApprovals });
}
```

#### 3.2 Update Client-Side Approval Handling
**File:** `packages/web/hooks/useSessionEvents.ts`

**Current (Single Approval):**
```typescript
const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequestData | null>(null);
```

**New (Multiple Approvals):**
```typescript
const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

// Process TOOL_APPROVAL_REQUEST events
if (event.type === 'TOOL_APPROVAL_REQUEST') {
  const toolCallData = getToolCallData(event.data.toolCallId);
  setPendingApprovals(prev => [...prev, {
    toolCallId: event.data.toolCallId,
    toolCall: toolCallData,
    requestedAt: event.timestamp
  }]);
}

// Process TOOL_APPROVAL_RESPONSE events  
if (event.type === 'TOOL_APPROVAL_RESPONSE') {
  setPendingApprovals(prev => 
    prev.filter(approval => approval.toolCallId !== event.data.toolCallId)
  );
}
```

#### 3.3 Add Recovery API
**File:** `packages/web/app/api/threads/[threadId]/approvals/pending/route.ts`

```typescript
export async function GET(
  request: NextRequest, 
  { params }: { params: { threadId: string } }
) {
  const { threadId } = await params;
  
  const sessionService = getSessionService(); 
  const threadManager = sessionService.getThreadManager();
  const db = threadManager.getDatabase();
  
  // Query pending approvals
  const pendingApprovals = db.prepare(`
    SELECT 
      req.data->>'toolCallId' as tool_call_id,
      tc.data as tool_call_data,
      req.timestamp as requested_at
    FROM events req
    JOIN events tc ON tc.data->>'id' = req.data->>'toolCallId'
    WHERE req.type = 'TOOL_APPROVAL_REQUEST'
      AND req.thread_id = ?
      AND tc.type = 'TOOL_CALL' 
      AND NOT EXISTS (
        SELECT 1 FROM events resp
        WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
          AND resp.data->>'toolCallId' = req.data->>'toolCallId'
      )
    ORDER BY req.timestamp ASC
  `).all(threadId);
  
  return NextResponse.json({ pendingApprovals });
}
```

#### 3.4 Update UI Components
**File:** `packages/web/components/modals/ToolApprovalModal.tsx`

**Remove timeout-related props (already done):**
- No `onTimeout` prop
- No timer state or countdown UI

**Update to handle multiple approvals:**
```typescript
interface ToolApprovalModalProps {
  approvals: PendingApproval[];           // Array instead of single request
  onDecision: (toolCallId: string, decision: ApprovalDecision) => void;
}

export function ToolApprovalModal({ approvals, onDecision }: ToolApprovalModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentApproval = approvals[currentIndex];
  
  if (!currentApproval) return null;
  
  return (
    <div className="modal">
      {/* Show "1 of 3" indicator */}
      <div className="approval-counter">
        {currentIndex + 1} of {approvals.length}
      </div>
      
      {/* Tool approval UI for current approval */}
      {/* ... existing UI ... */}
      
      {/* Navigation for multiple approvals */}
      {approvals.length > 1 && (
        <div className="approval-navigation">
          <button 
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
          >
            Previous
          </button>
          <button
            onClick={() => setCurrentIndex(Math.min(approvals.length - 1, currentIndex + 1))}
            disabled={currentIndex === approvals.length - 1}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

#### 3.5 Recovery on Connection
**File:** `packages/web/hooks/useSessionEvents.ts`

```typescript
useEffect(() => {
  if (connected && threadId) {
    // Fetch pending approvals on connection/reconnection
    fetch(`/api/threads/${threadId}/approvals/pending`)
      .then(res => res.json())
      .then(data => {
        setPendingApprovals(data.pendingApprovals.map(approval => ({
          toolCallId: approval.tool_call_id,
          toolCall: approval.tool_call_data,
          requestedAt: new Date(approval.requested_at)
        })));
      });
  }
}, [connected, threadId]);
```

### Phase 4: Session Integration

#### 4.1 Update Session.toolPolicies Integration
**File:** `src/tools/executor.ts`

The existing session policy checking should work unchanged:

```typescript
// This existing code should work with new approval system
if (context?.session) {
  const policy = context.session.getToolPolicy(call.name);
  
  switch (policy) {
    case 'deny':
      return createErrorResult(`Tool '${call.name}' execution denied by policy`, call.id);
    case 'require-approval':
      // Falls through to approval system (now event-based)
      break; 
    case 'allow':
      return this.executeToolDirect(tool, call, context);
  }
}
```

#### 4.2 ALLOW_SESSION Handling
When user selects "Allow Session", update session configuration:

```typescript
// In approval response handler
if (decision === ApprovalDecision.ALLOW_SESSION) {
  const session = getSessionFromThread(threadId);
  const currentConfig = session.getEffectiveConfiguration();
  
  // Update toolPolicies to allow this tool
  const updatedConfig = {
    ...currentConfig,
    toolPolicies: {
      ...currentConfig.toolPolicies,
      [toolName]: 'allow'
    }
  };
  
  session.updateConfiguration(updatedConfig);
}
```

### Phase 5: Global Policies

#### 5.1 Task Manager Auto-Approval
**File:** `src/sessions/session-config.ts`

Add default configuration that auto-approves task management tools:

```typescript
export const DEFAULT_SESSION_CONFIG: SessionConfiguration = {
  toolPolicies: {
    // Auto-approve all task management tools
    'task-create': 'allow',
    'task-list': 'allow', 
    'task-complete': 'allow',
    'task-update': 'allow',
    'task-add-note': 'allow',
    'task-view': 'allow',
  }
};
```

**Rationale:** Task management tools are always safe and should not require approval interruptions.

## Files to Remove

### Broken Web Approval System
1. `packages/web/lib/server/approval-manager.ts` - Fundamentally broken Promise-based system
2. `packages/web/lib/server/approval-manager.test.ts` - Tests for broken system
3. `packages/web/app/api/approvals/[requestId]/route.ts` - API route for broken system

### Remove Broken Session Service Approval Handler
**File:** `packages/web/lib/server/session-service.ts`

Remove approval_request event handler (lines 228-274):
```typescript
// DELETE THIS ENTIRE BLOCK - no longer needed with core event system
agent.on('approval_request', ({ toolName, input, isReadOnly, requestId, resolve }) => {
  const approvalManager = getApprovalManager();
  // ... all this Promise-based approval logic is broken
});
```

**Rationale:** The core `EventApprovalCallback` handles approval logic directly through ThreadManager events. The web layer no longer needs to listen to ephemeral `approval_request` events or manage Promise resolvers.

### Required Core System Updates

#### Agent Public API Extensions
**File:** `src/agents/agent.ts`

The Agent class needs to expose ThreadManager access for the approval system:

```typescript
// Already exists - no changes needed
get threadManager(): ThreadManager {
  return this._threadManager;
}

get threadId(): string {
  return this._threadId;
}
```

**Rationale:** The `EventApprovalCallback` needs access to the Agent's ThreadManager and current thread ID. These getters should already exist based on the system-reminder showing recent changes.

#### ThreadManager Event Emission
**File:** `src/threads/thread-manager.ts`

Ensure ThreadManager emits events when new events are added:

```typescript
addEvent(/* ... */): ThreadEvent {
  // ... existing event creation logic ...
  
  // Emit event for approval system listeners
  this.emit('event_added', event);
  
  return event;
}
```

**Note:** The system-reminder shows that event emission was removed from ThreadManager with the comment "Agent will handle event emission for UI synchronization". We may need to add back event emission specifically for the approval system, or route through the Agent's event emission.

#### Core System Exports for Web Layer
**File:** `src/tools/index.ts` or similar

The web layer needs to import these core classes:

```typescript
// Export approval system for web layer
export { EventApprovalCallback } from './event-approval-callback';
export { ApprovalCallback, ApprovalDecision } from './approval-types';
```

**File:** `packages/web/lib/server/lace-imports.ts`

Update imports to use core approval system:

```typescript
// Import from core tools system
export { 
  Agent,
  EventApprovalCallback,  // New core approval system
  ApprovalDecision 
} from '@/../../../src/tools';  // Adjust path as needed
```

## Testing Strategy

### Unit Tests (Focus on Core System)

#### Core Approval Logic Tests
**File:** `src/tools/event-approval-callback.test.ts`

```typescript
describe('EventApprovalCallback', () => {
  it('should create TOOL_APPROVAL_REQUEST event when approval needed', async () => {
    const mockAgent = createMockAgent();
    const mockThreadManager = createMockThreadManager();
    const callback = new EventApprovalCallback(mockAgent, mockThreadManager, 'thread_123');
    
    // Setup: Create TOOL_CALL event first
    mockThreadManager.addEvent('thread_123', 'TOOL_CALL', {
      id: 'call_123',
      name: 'bash', 
      arguments: { command: 'ls' }
    });
    
    // Trigger approval request
    const approvalPromise = callback.requestApproval('bash', { command: 'ls' });
    
    // Verify TOOL_APPROVAL_REQUEST event was created
    expect(mockThreadManager.addEvent).toHaveBeenCalledWith(
      'thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_123' }
    );
  });
  
  it('should resolve when TOOL_APPROVAL_RESPONSE event is created', async () => {
    // Test the waiting mechanism
  });
  
  it('should find existing approval response during recovery', async () => {
    // Test recovery scenario
  });
});
```

#### ThreadManager Approval Query Tests  
**File:** `src/threads/approval-queries.test.ts`

```typescript
describe('ThreadManager Approval Queries', () => {
  it('should find pending approvals', () => {
    const threadManager = new ThreadManager();
    const threadId = threadManager.generateThreadId();
    
    // Create TOOL_CALL → TOOL_APPROVAL_REQUEST
    const toolCallEvent = threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123', name: 'bash', arguments: { command: 'ls' }
    });
    threadManager.addEvent(threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: 'call_123'
    });
    
    // Query should find pending approval
    const pending = threadManager.getPendingApprovals(threadId);
    expect(pending).toHaveLength(1);
    expect(pending[0].toolCallId).toBe('call_123');
    expect(pending[0].toolCall.name).toBe('bash');
  });
  
  it('should not find resolved approvals', () => {
    // Create request + response, verify not returned by pending query
  });
  
  it('should get approval decision for specific tool call', () => {
    // Test getApprovalDecision method
  });
});
```

### Web Integration Tests (Thin Layer)

#### Web API Integration
**File:** `packages/web/app/api/threads/approvals.integration.test.ts`

```typescript
describe('Approval API Integration', () => {
  it('should delegate approval response to core ThreadManager', async () => {
    // Test that web API properly calls core system methods
    // Focus on integration, not reimplementation of core logic
  });
  
  it('should delegate pending approvals query to core ThreadManager', async () => {
    // Test recovery API uses core query methods
  });
});
```

## Summary of Architectural Changes

### What Moved to Core (`src/tools/`)
1. **Event-based ApprovalCallback implementation** - `EventApprovalCallback` class
2. **Approval event management** - Creating REQUEST/RESPONSE events
3. **Tool call event matching** - Finding TOOL_CALL events by name/input
4. **Approval response waiting** - Promise-based waiting for RESPONSE events
5. **Recovery logic** - Checking for existing approval responses

### What Stayed in Web (`packages/web/`)
1. **Thin API routes** - Delegate to core ThreadManager methods
2. **SSE event broadcasting** - Web-specific event streaming to UI
3. **UI recovery calls** - Browser refresh recovery API calls
4. **Session service integration** - Mapping agents to web concerns

### Benefits of This Architecture
- ✅ **Reusable**: CLI interface can also use `EventApprovalCallback`
- ✅ **Testable**: Core approval logic can be unit tested independently
- ✅ **Maintainable**: Web package focused on web concerns only
- ✅ **Consistent**: Same approval system across all interfaces
- ✅ **Process-safe**: Core system handles all approval persistence

```typescript
describe('Approval Queries', () => {
  it('should find pending approvals', () => {
    const threadManager = new ThreadManager();
    const threadId = threadManager.generateThreadId();
    
    // Create TOOL_CALL → TOOL_APPROVAL_REQUEST
    const toolCallEvent = threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123', name: 'bash', arguments: { command: 'ls' }
    });
    threadManager.addEvent(threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: 'call_123'
    });
    
    // Query should find pending approval
    const pending = threadManager.getPendingApprovals(threadId);
    expect(pending).toHaveLength(1);
    expect(pending[0].toolCallId).toBe('call_123');
  });
  
  it('should not find resolved approvals', () => {
    // Create request + response, verify not returned by pending query
  });
});
```

### Integration Tests

#### 5.3 End-to-End Approval Flow
**File:** `packages/web/app/approval-flow-integration.test.ts`

```typescript
describe('Tool Approval Integration', () => {
  it('should handle full approval workflow', async () => {
    // 1. Agent requests tool execution
    // 2. TOOL_APPROVAL_REQUEST event created
    // 3. SSE broadcasts to web UI
    // 4. User makes decision via API
    // 5. TOOL_APPROVAL_RESPONSE event created
    // 6. Tool execution resumes
    // 7. TOOL_RESULT event created
  });
  
  it('should recover pending approvals after browser refresh', async () => {
    // 1. Create pending approval
    // 2. Simulate browser refresh 
    // 3. Call recovery API
    // 4. Verify pending approvals returned
  });
});
```

### Performance Tests

#### 5.4 Query Performance
**File:** `src/threads/approval-performance.test.ts`

```typescript
describe('Approval Query Performance', () => {
  it('should efficiently query pending approvals with large event count', () => {
    const threadManager = new ThreadManager();
    const threadId = threadManager.generateThreadId();
    
    // Create 10,000 events including 100 pending approvals
    // Verify query completes in <100ms
    
    const startTime = Date.now();
    const pending = threadManager.getPendingApprovals(threadId);
    const duration = Date.now() - startTime;
    
    expect(pending).toHaveLength(100);
    expect(duration).toBeLessThan(100);
  });
});
```

## Migration Strategy

### Phase 1: Infrastructure (No User Impact)
1. Add new event types to `EVENT_TYPES`
2. Add database indexes for approval queries
3. Create new API routes (keep old ones active)
4. Update ThreadManager with approval query methods

### Phase 2: Backend Migration (No UI Changes)
1. Update ApprovalCallback to use events instead of Promises
2. Test event-based approval flow in isolation
3. Verify recovery queries work correctly

### Phase 3: Frontend Migration
1. Update web UI to handle multiple approvals
2. Add recovery API calls on connection
3. Switch API calls to new endpoints
4. Test browser refresh recovery

### Phase 4: Cleanup
1. Remove old ApprovalManager system
2. Remove old API routes
3. Remove timeout-related code (already done)
4. Clean up session service event handlers

## Monitoring & Observability

### Key Metrics
1. **Approval Response Time**: Time from TOOL_APPROVAL_REQUEST to TOOL_APPROVAL_RESPONSE
2. **Approval Recovery Rate**: % of pending approvals successfully recovered after reconnection
3. **Query Performance**: Time to execute pending approval queries
4. **Approval Abandonment**: TOOL_APPROVAL_REQUEST events without responses

### Logging
```typescript
// Log approval lifecycle events
logger.info('Tool approval requested', {
  threadId,
  toolCallId, 
  toolName,
  timestamp: new Date()
});

logger.info('Tool approval resolved', {
  threadId,
  toolCallId,
  decision,
  responseTime: Date.now() - requestTime
});
```

## Security Considerations

### 1. Authorization
- Verify user has access to thread before processing approval
- Validate tool call exists and belongs to thread
- Ensure approval decisions come from authenticated users

### 2. Data Integrity
- Prevent duplicate TOOL_APPROVAL_RESPONSE events for same tool call
- Validate ApprovalDecision enum values
- Ensure tool call IDs reference valid TOOL_CALL events

### 3. Audit Trail
- Complete approval history preserved in event stream
- Timestamps show approval request/response timing
- User context preserved in event metadata

## Future Extensibility

### Pattern-Based Approvals
Foundation for advanced approval rules:

```typescript
// Future: Fine-grained approval patterns
const approvalPatterns = [
  {
    pattern: 'bash:ls*',           // Allow any 'ls' command
    action: 'allow'
  },
  {
    pattern: 'bash:rm*',           // Deny any 'rm' command  
    action: 'deny'
  },
  {
    pattern: 'web-fetch:https://*', // Allow HTTPS URLs only
    action: 'allow'
  }
];
```

The event-based architecture provides a solid foundation for these advanced features without requiring architectural changes.

## Conclusion

This design solves all current approval system problems while maintaining architectural elegance:

✅ **Process-Safe**: No Promise storage across process boundaries  
✅ **Persistent**: SQLite-based durability survives server restarts  
✅ **Recoverable**: Database queries rebuild approval state after disconnection  
✅ **Multi-Approval**: Supports multiple simultaneous approval requests  
✅ **Integrated**: Uses existing ThreadManager and event system  
✅ **Performant**: Efficient database queries with proper indexing  
✅ **Extensible**: Foundation for pattern-based approval rules  

The implementation preserves event-sourcing principles while providing practical solutions for production web interface needs.