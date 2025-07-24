# Tool Approval System Redesign

**Date:** 2025-07-24  
**Status:** Design Phase  
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

#### 1.1 Update Event Types
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

#### 1.2 Database Migration
**File:** `src/persistence/migrations/add_approval_indexes.sql`

```sql
-- Optimize approval queries
CREATE INDEX IF NOT EXISTS idx_approval_tool_call_id 
ON events ((data->>'toolCallId')) 
WHERE type IN ('TOOL_APPROVAL_REQUEST', 'TOOL_APPROVAL_RESPONSE');

CREATE INDEX IF NOT EXISTS idx_tool_call_id
ON events ((data->>'id'))
WHERE type = 'TOOL_CALL';
```

### Phase 2: Core Approval Logic

#### 2.1 Replace ApprovalCallback Implementation
**File:** `packages/web/lib/server/agent-utils.ts`

**Current (Broken):**
```typescript
async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
  return new Promise<ApprovalDecision>((resolve) => {
    const requestId = `${toolName}-${Date.now()}`;
    
    // Emit ephemeral event with Promise resolver
    agent.emit('approval_request', {
      toolName, input, isReadOnly, requestId, resolve
    });
  });
}
```

**New (Event-Based):**
```typescript
async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
  // Find the TOOL_CALL event that triggered this approval
  const toolCallEvent = this.findRecentToolCallEvent(toolName, input);
  
  // Create TOOL_APPROVAL_REQUEST event
  const requestEvent = this.agent.threadManager.addEvent(
    this.threadId,
    'TOOL_APPROVAL_REQUEST',
    { toolCallId: toolCallEvent.data.id }
  );
  
  // Wait for TOOL_APPROVAL_RESPONSE event
  return this.waitForApprovalResponse(toolCallEvent.data.id);
}

private waitForApprovalResponse(toolCallId: string): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    // Listen for new events
    this.agent.threadManager.on('event_added', (event) => {
      if (event.type === 'TOOL_APPROVAL_RESPONSE' && 
          event.data.toolCallId === toolCallId) {
        resolve(event.data.decision);
      }
    });
    
    // Check if response already exists (recovery case)
    const existingResponse = this.checkExistingApprovalResponse(toolCallId);
    if (existingResponse) {
      resolve(existingResponse);
    }
  });
}

private checkExistingApprovalResponse(toolCallId: string): ApprovalDecision | null {
  const events = this.agent.threadManager.getEvents(this.threadId);
  const responseEvent = events.find(e => 
    e.type === 'TOOL_APPROVAL_RESPONSE' && 
    e.data.toolCallId === toolCallId
  );
  return responseEvent?.data.decision || null;
}
```

#### 2.2 Remove Broken ApprovalManager
**Files to delete:**
- `packages/web/lib/server/approval-manager.ts` 
- `packages/web/lib/server/approval-manager.test.ts`

**Rationale:** This entire system is fundamentally broken and replaced by event-based approach.

### Phase 3: Web Interface Updates

#### 3.1 Update API Routes
**Delete:** `packages/web/app/api/approvals/[requestId]/route.ts`

**Create:** `packages/web/app/api/threads/[threadId]/approvals/[toolCallId]/route.ts`

```typescript
export async function POST(
  request: NextRequest,
  { params }: { params: { threadId: string; toolCallId: string } }
) {
  const { threadId, toolCallId } = await params;
  const { decision } = await request.json();
  
  // Get core thread manager
  const sessionService = getSessionService();
  const threadManager = sessionService.getThreadManager();
  
  // Create TOOL_APPROVAL_RESPONSE event
  threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
    toolCallId,
    decision
  });
  
  return NextResponse.json({ success: true });
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

### Cleanup Session Service
**File:** `packages/web/lib/server/session-service.ts`

Remove approval_request event handler (lines 228-274):
```typescript
// DELETE THIS ENTIRE BLOCK
agent.on('approval_request', ({ toolName, input, isReadOnly, requestId, resolve }) => {
  // ... broken Promise-based approval logic
});
```

## Testing Strategy

### Unit Tests

#### 5.1 Event Creation Tests
**File:** `src/threads/approval-events.test.ts`

```typescript
describe('Approval Events', () => {
  it('should create TOOL_APPROVAL_REQUEST event', () => {
    const threadManager = new ThreadManager();
    const threadId = threadManager.generateThreadId();
    
    // Create TOOL_CALL first
    const toolCallEvent = threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123',
      name: 'bash',
      arguments: { command: 'ls' }
    });
    
    // Create approval request
    const requestEvent = threadManager.addEvent(threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: toolCallEvent.data.id
    });
    
    expect(requestEvent.type).toBe('TOOL_APPROVAL_REQUEST');
    expect(requestEvent.data.toolCallId).toBe('call_123');
  });
  
  it('should create TOOL_APPROVAL_RESPONSE event', () => {
    // Similar test for response event
  });
});
```

#### 5.2 Query Tests  
**File:** `src/threads/approval-queries.test.ts`

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