# Protocol Events Migration Specification

**Goal**: Make protocol events THE internal event system for the web package.
LaceEvent stays in the agent package as its internal representation.

**Date**: 2026-01-05 **Status**: Implemented (web consumes protocol events
directly)

---

## Executive Summary

Previously, the web package received protocol events from the supervisor,
translated them to LaceEvent format, then consumed LaceEvent throughout the UI.
This created an unnecessary translation layer and coupled the web package to
agent internals.

**Current State**: Web consumes protocol events directly via
`AppEvent = ProtocolEvent | PermissionRequestEvent | WebEvent` and derives a
stable timeline model in `useProcessedEvents`.

**Target State**: Web package consumes protocol event types DIRECTLY. LaceEvent
remains agent-internal only.

---

## Current State Analysis

### Event Flow Architecture

```
Supervisor → protocol events (text_delta, tool_use, etc.)
    ↓
packages/web/types/* (ProtocolEvent wrappers)
    ↓
AppEvent (ProtocolEvent | PermissionRequestEvent | WebEvent) ← Web components consume this
```

### Key Components

1. **Protocol Events** (`@lace/ent-protocol`)
   - Wire format: `session/update` notifications with discriminated union types
   - Event types: `text_delta`, `thinking`, `usage`, `tool_use`, `turn_start`,
     `turn_end`, `error`, etc.
   - Location: `packages/ent-protocol/src/schemas/methods.ts`
     (SessionUpdateParamsSchema)
   - Additional: `session/request_permission` for tool approvals

2. **Supervisor Events** (`@lace/supervisor`)
   - Wraps protocol events + adds workspace context
   - Types: `SupervisorServerEvent` = `session_update | permission_request`
   - Location: `packages/supervisor/src/http/types.ts`

3. **LaceEvent** (`@lace/agent`)
   - Internal agent representation
   - Types: conversation events, transient streaming events, and workflow events
     (agent-internal only)
   - Location: `packages/agent/src/threads/types.ts`
   - **36 total event types** including transient and persisted

4. **Web Event Model** (`packages/web/types`)
   - Protocol wrappers: `packages/web/types/protocol-events.ts`
   - Web events: `packages/web/types/web-events.ts`
   - Unified union + type guards: `packages/web/types/app-events.ts`
   - Timeline derived model: `packages/web/hooks/useProcessedEvents.ts`

### Web Package LaceEvent Usage

**Files using LaceEvent** (20 files total):

- `types/core.ts` - Re-exports LaceEvent from `@lace/agent/threads/types`
- `lib/event-stream-manager.ts` - Broadcasts LaceEvent via SSE
- `lib/sse-store.ts` - Subscription store filtering LaceEvent
- `hooks/useEventStream.ts` - Event handlers for LaceEvent types
- `hooks/useProcessedEvents.ts` - Timeline event processing
- `hooks/useAgentEvents.ts` - Agent event management
- `hooks/useAgentTokenUsage.ts` - Token usage tracking
- `components/timeline/*` - Timeline rendering components
- `components/debug/EventStreamMonitor.tsx` - Debug monitoring
- `components/providers/EventStreamProvider.tsx` - Context provider
- `app/routes/api.agents.$agentId.history.ts` - API route

---

## Protocol Update Types → Timeline Mapping

### Timeline model

| Protocol Update | Timeline entry            | Notes                                                                |
| --------------- | ------------------------- | -------------------------------------------------------------------- |
| `text_delta`    | transient `AGENT_MESSAGE` | Aggregated by `(agentSessionId, turnId)` with derived id fallback    |
| `turn_end`      | final `AGENT_MESSAGE`     | Finalizes content for a turn                                         |
| `tool_use`      | `TOOL_AGGREGATED`         | Includes tool call + result; permission request attached in metadata |
| `error`         | `AGENT_ERROR`             | Rendered via `AgentErrorEntry`                                       |

### Web-internal events (non-protocol)

These are web-generated and not part of the protocol event stream:

| WebEvent                 | Source          | Notes                                                        |
| ------------------------ | --------------- | ------------------------------------------------------------ |
| `USER_MESSAGE`           | Optimistic send | Not the durable protocol record; used for instant UX         |
| `AGENT_STATE_CHANGE`     | Supervisor/web  | Drives busy/typing state                                     |
| `LOCAL_SYSTEM_MESSAGE`   | Web             | Connection + UX messaging                                    |
| `TOOL_APPROVAL_RESPONSE` | Web             | User decision (paired with durable protocol permission flow) |

---

## Data Structure Comparison

### Protocol Event Structure

```typescript
// From ent-protocol SessionUpdateNotificationSchema
{
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: string,           // Agent session ID
    streamSeq: number,
    turnId?: string,
    turnSeq?: number,
    jobId?: string,

    // Discriminated union based on type
    type: "text_delta" | "tool_use" | "thinking" | ...,

    // Type-specific fields
    text?: string,               // For text_delta, thinking
    toolCallId?: string,         // For tool_use
    name?: string,               // For tool_use
    input?: Record<string, unknown>,
    status?: "pending" | "running" | "completed" | ...,
    result?: { outcome, content, meta },
    // ... many other type-specific fields
  }
}

// Permission request (separate JSON-RPC method)
{
  jsonrpc: "2.0",
  id: string | number,
  method: "session/request_permission",
  params: {
    sessionId: string,
    turnId: string,
    turnSeq: number,
    toolCallId: string,
    tool: string,
    kind?: string,
    resource: string,
    options: Array<{ optionId, label }>,
    requestedAt: string,
  }
}
```

### LaceEvent Structure

```typescript
{
  id?: string,
  timestamp?: Date,
  type: string,
  data: any,  // Type-specific data
  transient?: boolean,
  visibleToModel?: boolean,
  context?: {
    sessionId?: string,         // Workspace session ID
    projectId?: string,
    taskId?: string,
    threadId?: string,          // Agent session ID
    systemMessage?: boolean,
  }
}
```

### Key Structural Differences

1. **ID Context**:
   - Protocol: `sessionId` = agent session, embedded in params
   - LaceEvent: `context.threadId` = agent session, `context.sessionId` =
     workspace session

2. **Metadata**:
   - Protocol: `streamSeq`, `turnId`, `turnSeq`, `jobId` at top level
   - LaceEvent: Minimal metadata, mostly in `context`

3. **Tool Results**:
   - Protocol: `outcome` enum + `content` array with discriminated union
   - LaceEvent: `status` enum + `content` array with simpler structure

4. **Error Reporting**:
   - Protocol: `error` type with `code`, `message`, `phase`, `details`
   - LaceEvent: `AGENT_ERROR` with nested `AgentErrorData` structure

---

## Migration Strategy

### Phase 1: Create Protocol Event Type Definitions (SMALL)

**Goal**: Define TypeScript types for protocol events that web package will
consume.

**Files to create**:

- `packages/web/types/protocol-events.ts` - Web-friendly protocol event types

**Approach**:

1. Import protocol schemas from `@lace/ent-protocol`
2. Use `z.infer<>` to extract TypeScript types
3. Add helper types for common patterns (tool status, content blocks, etc.)
4. Create discriminated union type for all session update events

**Example**:

```typescript
// packages/web/types/protocol-events.ts
import type { z } from 'zod';
import {
  SessionUpdateNotificationSchema,
  SessionRequestPermissionRequestSchema,
} from '@lace/ent-protocol';

export type SessionUpdate = z.infer<
  typeof SessionUpdateNotificationSchema
>['params'];
export type PermissionRequest = z.infer<
  typeof SessionRequestPermissionRequestSchema
>['params'];

// Extract individual update types
export type TextDeltaUpdate = Extract<SessionUpdate, { type: 'text_delta' }>;
export type ThinkingUpdate = Extract<SessionUpdate, { type: 'thinking' }>;
export type ToolUseUpdate = Extract<SessionUpdate, { type: 'tool_use' }>;
// ... etc for all update types

// Web-specific event wrapper (replaces LaceEvent for protocol events)
export interface ProtocolEvent {
  // Metadata
  id: string;
  timestamp: Date;

  // Protocol data
  update: SessionUpdate;

  // Context (from supervisor)
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId: string; // from update.sessionId
}

export interface PermissionRequestEvent {
  id: string;
  timestamp: Date;
  request: PermissionRequest;
  workspaceSessionId: string;
  projectId?: string;
}
```

**Complexity**: SMALL (2-3 hours)

---

### Phase 2: Update Translation Layer (MEDIUM)

**Goal**: Modify `supervisor-service.ts` to emit protocol events instead of
LaceEvent.

**Files to modify**:

- `packages/web/lib/server/supervisor-service.ts`

**Changes**:

1. Remove `updateToLaceEvents()` function
2. Modify `bridgeEventToWeb()` to pass protocol events directly
3. Update EventStreamManager to handle `ProtocolEvent` type
4. Keep workspace/project context wrapping

**Before**:

```typescript
function bridgeEventToWeb(event: SupervisorServerEvent) {
  if (event.type === 'session_update') {
    const laceEvents = updateToLaceEvents({...});  // Translation
    for (const e of laceEvents) manager.broadcast(e);
  }
}
```

**After**:

```typescript
function bridgeEventToWeb(event: SupervisorServerEvent) {
  if (event.type === 'session_update') {
    const protocolEvent: ProtocolEvent = {
      id: generateEventId(),
      timestamp: new Date(),
      update: event.update,
      workspaceSessionId: event.workspaceSessionId,
      projectId: event.projectId,
      agentSessionId: event.update.sessionId,
    };
    manager.broadcast(protocolEvent);
  }

  if (event.type === 'permission_request') {
    const permissionEvent: PermissionRequestEvent = {...};
    manager.broadcast(permissionEvent);
  }
}
```

**Complexity**: MEDIUM (4-6 hours)

---

### Phase 3: Update Event Stream Infrastructure (LARGE)

**Goal**: Modify event broadcasting and subscription to work with protocol
events.

**Files to modify**:

- `packages/web/lib/event-stream-manager.ts`
- `packages/web/lib/sse-store.ts`
- `packages/web/types/stream-events.ts`

**Changes**:

1. **EventStreamManager**:
   - Change `broadcast()` parameter from `LaceEvent` to
     `ProtocolEvent | PermissionRequestEvent | WebEvent`
   - Update filtering logic to work with protocol event structure
   - Update `shouldSendToConnection()` to filter by `agentSessionId` instead of
     `context.threadId`

2. **SSEStore**:
   - Update `EventFilter` interface for protocol event structure
   - Modify `eventMatchesFilter()` for new event shape
   - Update subscription callbacks to receive protocol events

3. **Web-Internal Events**:
   - Define `WebEvent` type for web-generated events:
     - `USER_MESSAGE`
     - `AGENT_STATE_CHANGE`
     - `AGENT_SPAWNED`
     - `PROJECT_CREATED/UPDATED/DELETED`
     - etc.

**Example WebEvent**:

```typescript
// packages/web/types/web-events.ts
export type WebEventType =
  | 'USER_MESSAGE'
  | 'AGENT_STATE_CHANGE'
  | 'AGENT_SPAWNED'
  | 'PROJECT_CREATED';
// ... etc

export interface WebEvent {
  id: string;
  timestamp: Date;
  type: WebEventType;
  data: any; // Discriminated by type
  workspaceSessionId?: string;
  projectId?: string;
  agentSessionId?: string;
}

// Union type for all events web package handles
export type AppEvent = ProtocolEvent | PermissionRequestEvent | WebEvent;
```

**Complexity**: LARGE (8-12 hours)

---

### Phase 4: Update Event Hooks (LARGE)

**Goal**: Modify React hooks to consume protocol events instead of LaceEvent.

**Files to modify**:

- `packages/web/hooks/useEventStream.ts` - Event handler routing
- `packages/web/hooks/useProcessedEvents.ts` - Timeline processing
- `packages/web/hooks/useAgentEvents.ts` - Event collection
- `packages/web/hooks/useAgentTokenUsage.ts` - Token tracking

**Changes**:

1. **useEventStream.ts**:
   - Update `EventHandlers` interface for protocol events
   - Replace LaceEvent type switches with protocol event type discrimination
   - Map protocol events to handler callbacks

**Before**:

```typescript
switch (event.type) {
  case 'USER_MESSAGE':
    onUserMessage?.(event);
    break;
  case 'AGENT_MESSAGE':
    onAgentMessage?.(event);
    break;
}
```

**After**:

```typescript
if (isProtocolEvent(event)) {
  switch (event.update.type) {
    case 'text_delta':
      onTextDelta?.({ text: event.update.text, agentId: event.agentSessionId });
      break;
    case 'tool_use':
      if (event.update.status === 'pending') {
        onToolCall?.({...});
      }
      break;
  }
} else if (isWebEvent(event)) {
  // Handle web-internal events
}
```

2. **useProcessedEvents.ts**:
   - Rewrite `processStreamingTokens()` to aggregate `text_delta` events
   - Rewrite `processToolCallAggregation()` to pair `tool_use` events
   - Return `ProcessedProtocolEvent` instead of `ProcessedEvent`

3. **useAgentEvents.ts**:
   - Store protocol events instead of LaceEvent
   - Update filtering logic
   - Modify API for components that consume events

**Complexity**: LARGE (12-16 hours)

---

### Phase 5: Update Timeline Components (LARGE)

**Goal**: Modify timeline rendering to work with protocol events.

**Files to modify**:

- `packages/web/components/timeline/TimelineView.tsx`
- `packages/web/components/timeline/TimelineMessage.tsx`
- `packages/web/components/timeline/AgentErrorEntry.tsx`
- Related timeline components

**Changes**:

1. Replace `LaceEvent` imports with `ProtocolEvent` and `WebEvent`
2. Update event type checks and data access patterns
3. Modify rendering logic for new event shapes

**Example**:

```typescript
// Before
function renderEvent(event: LaceEvent) {
  if (event.type === 'AGENT_MESSAGE') {
    return <div>{event.data.content}</div>;
  }
}

// After
function renderEvent(event: AppEvent) {
  if (isProtocolEvent(event) && event.update.type === 'turn_end') {
    const content = event.update.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
    return <div>{content}</div>;
  }
}
```

**Complexity**: LARGE (10-14 hours)

---

### Phase 6: Update Provider Components (MEDIUM)

**Goal**: Update context providers to work with protocol events.

**Files to modify**:

- `packages/web/components/providers/EventStreamProvider.tsx`
- Related context providers

**Changes**:

1. Update type imports
2. Modify event handler interfaces
3. Update context value types

**Complexity**: MEDIUM (4-6 hours)

---

### Phase 7: Update API Routes (SMALL)

**Goal**: Ensure API routes that return events use correct types.

**Files to modify**:

- `packages/web/app/routes/api.agents.$agentId.history.ts`

**Changes**:

1. Update response types
2. Ensure serialization handles protocol events correctly

**Complexity**: SMALL (2-3 hours)

---

### Phase 8: Update Debug & Testing (MEDIUM)

**Goal**: Fix debug tools and tests to work with new event system.

**Files to modify**:

- `packages/web/components/debug/EventStreamMonitor.tsx`
- `packages/web/types/events.test.ts`
- `packages/web/hooks/__tests__/useSmartAutoscroll.test.tsx`
- `packages/web/components/chat/__tests__/Chat.test.tsx`
- Other test files using LaceEvent

**Changes**:

1. Update EventStreamMonitor to display protocol events
2. Rewrite event-related tests
3. Update test fixtures and mocks

**Complexity**: MEDIUM (6-8 hours)

---

### Phase 9: Remove LaceEvent Dependencies (SMALL)

**Goal**: Clean up imports and remove dead code.

**Files to modify**:

- `packages/web/types/core.ts` - Remove LaceEvent re-exports

**Changes**:

1. Remove `export type { LaceEvent, ... } from '@lace/agent/threads/types'`
2. Remove unused agent imports
3. Update documentation

**Complexity**: SMALL (1-2 hours)

---

## Risks & Considerations

### Technical Risks

1. **Type Safety Loss**:
   - **Risk**: Protocol events use Zod schemas; extracting types may lose some
     runtime validation
   - **Mitigation**: Keep Zod schemas imported; add runtime type guards where
     needed

2. **Event Processing Complexity**:
   - **Risk**: Protocol events are more granular; may need more client-side
     aggregation
   - **Mitigation**: Build robust event processing in `useProcessedEvents` hook

3. **Missing Protocol Events**:
   - **Risk**: Some LaceEvent types have no protocol equivalent (jobs,
     mode_change, etc.)
   - **Mitigation**: Identify if web needs these; add to protocol if necessary
     OR keep as web-internal events

4. **Streaming Performance**:
   - **Risk**: More events = more network traffic and processing
   - **Mitigation**: Benchmark and optimize; consider server-side event
     coalescing if needed

### Migration Risks

1. **Breaking Changes**:
   - **Risk**: All event-consuming code must change simultaneously
   - **Mitigation**: Use feature flag or parallel implementation during
     transition

2. **Testing Coverage**:
   - **Risk**: Extensive testing needed to ensure UI still works correctly
   - **Mitigation**: Comprehensive E2E tests before merging

3. **Timeline Rendering**:
   - **Risk**: Timeline aggregation logic is complex; easy to break
   - **Mitigation**: Port tests first; validate against known conversation
     histories

### Open Questions

1. **Job Events**: Protocol has `job_started`, `job_finished`, `job_update` -
   does web need these?
   - Current LaceEvent doesn't have job equivalents
   - Supervisor supports jobs but web may not consume them yet

2. **Turn Boundaries**: Protocol has explicit `turn_start` and `turn_end`
   - How should web display these? As message boundaries?
   - Current web uses `AGENT_MESSAGE` (synthesized); `turn_end` has content

3. **Thinking Tokens**: Protocol has `thinking` type
   - How should web display these? Separate from text?
   - Current web doesn't show thinking separately

4. **Mode Changes**: Protocol has `mode_change` events
   - Does web need to display mode changes?
   - What modes exist? (planning vs execution?)

---

## Testing Strategy

### Unit Tests

- Event type guards and discriminators
- Event filtering logic in sse-store
- Event processing in useProcessedEvents
- Protocol event → UI data transformations

### Integration Tests

- Event flow from supervisor → web UI
- Timeline rendering with protocol events
- Tool approval flow with permission_request events
- Compaction events display

### E2E Tests

- Full conversation with streaming, tools, errors
- Multi-agent sessions
- Event filtering and subscription
- Reconnection and event replay

---

## File Impact Summary

### Files to Create (3 files)

- `packages/web/types/protocol-events.ts` - Protocol event types
- `packages/web/types/web-events.ts` - Web-internal event types
- `packages/web/types/app-events.ts` - Union types and type guards

### Files to Modify (25+ files)

**Critical Path** (must change together):

1. `packages/web/lib/server/supervisor-service.ts` - Translation layer
2. `packages/web/lib/event-stream-manager.ts` - Broadcasting
3. `packages/web/lib/sse-store.ts` - Subscriptions
4. `packages/web/hooks/useEventStream.ts` - Event handlers
5. `packages/web/hooks/useProcessedEvents.ts` - Timeline processing
6. `packages/web/hooks/useAgentEvents.ts` - Event collection
7. `packages/web/components/timeline/TimelineView.tsx` - Rendering

**Secondary** (can be updated incrementally):

- `packages/web/types/core.ts` - Type exports
- `packages/web/types/stream-events.ts` - Stream types
- `packages/web/hooks/useAgentTokenUsage.ts` - Token tracking
- `packages/web/components/timeline/TimelineMessage.tsx` - Message rendering
- `packages/web/components/timeline/AgentErrorEntry.tsx` - Error rendering
- `packages/web/components/providers/EventStreamProvider.tsx` - Context provider
- `packages/web/components/debug/EventStreamMonitor.tsx` - Debug UI
- `packages/web/app/routes/api.agents.$agentId.history.ts` - API route
- Test files (~6 files)

### Files to Delete (0 files)

- No files deleted; LaceEvent stays in agent package

---

## Implementation Complexity Estimates

| Phase                          | Complexity | Estimated Hours | Risk Level |
| ------------------------------ | ---------- | --------------- | ---------- |
| 1. Protocol Type Definitions   | SMALL      | 2-3             | LOW        |
| 2. Translation Layer           | MEDIUM     | 4-6             | MEDIUM     |
| 3. Event Stream Infrastructure | LARGE      | 8-12            | HIGH       |
| 4. Event Hooks                 | LARGE      | 12-16           | HIGH       |
| 5. Timeline Components         | LARGE      | 10-14           | HIGH       |
| 6. Provider Components         | MEDIUM     | 4-6             | MEDIUM     |
| 7. API Routes                  | SMALL      | 2-3             | LOW        |
| 8. Debug & Testing             | MEDIUM     | 6-8             | MEDIUM     |
| 9. Cleanup                     | SMALL      | 1-2             | LOW        |
| **TOTAL**                      |            | **49-70 hours** |            |

---

## Recommended Approach

### Option A: Big Bang Migration (NOT RECOMMENDED)

- Implement all phases in one PR
- High risk of breaking things
- Difficult to review

### Option B: Incremental with Feature Flag (RECOMMENDED)

1. Implement dual event system
2. Add feature flag to switch between LaceEvent and Protocol events
3. Implement phases 1-3 (infrastructure)
4. Implement phases 4-6 (hooks and components) behind flag
5. Enable flag in dev environment
6. Test thoroughly
7. Enable in production
8. Remove LaceEvent code (phase 9)

### Option C: Parallel Event System (ALTERNATIVE)

1. Keep LaceEvent system running
2. Add protocol event handling in parallel
3. Migrate components one by one
4. Remove LaceEvent when all components migrated

**Recommendation**: Option B with careful testing at each phase.

---

## Success Criteria

1. ✅ Web package no longer imports from `@lace/agent` for event types
2. ✅ All UI components render correctly with protocol events
3. ✅ Timeline shows all conversation elements (messages, tools, errors)
4. ✅ Streaming works smoothly (text deltas, thinking)
5. ✅ Tool approvals work correctly
6. ✅ Error events display properly
7. ✅ Event filtering and subscriptions work
8. ✅ No performance regression
9. ✅ All tests pass
10. ✅ TypeScript strict mode passes

---

## Next Steps

1. **Review this spec** with team
2. **Answer open questions** about job events, thinking display, mode changes
3. **Decide on migration approach** (feature flag vs parallel)
4. **Create implementation tasks** in task tracker
5. **Implement Phase 1** (protocol type definitions) as proof of concept
6. **Review and iterate** on type definitions before proceeding

---

## Appendix: Protocol Event Type Reference

### Core Session Updates

```typescript
type SessionUpdate =
  | TextDeltaUpdate // Streaming text
  | ThinkingUpdate // Thinking tokens
  | UsageUpdate // Token usage
  | ToolUseUpdate // Tool execution
  | TurnStartUpdate // Turn boundary
  | TurnEndUpdate // Turn completion
  | ErrorUpdate // Error events
  | SessionInfoUpdate // Session metadata
  | ContextWindowUpdate // Context usage
  | CompactionStartUpdate
  | CompactionCompleteUpdate
  | McpConfigChangedUpdate
  | McpServerStatusUpdate
  | ModeChangeUpdate
  | ContextInjectedUpdate
  | PlanUpdate
  | JobStartedUpdate
  | JobFinishedUpdate
  | JobUpdateUpdate;
```

### Permission Request

```typescript
interface PermissionRequest {
  sessionId: string;
  turnId: string;
  turnSeq: number;
  toolCallId: string;
  tool: string;
  kind?: string;
  resource: string;
  options: Array<{ optionId: string; label: string }>;
  requestedAt: string;
}
```

---

**End of Specification**
