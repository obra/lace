# Event Architecture Consolidation - Critical Technical Debt

## Executive Summary

Lace has **FOUR separate, incompatible event architectures** that evolved independently, causing type mismatches, debugging complexity, and feature bugs. This analysis documents the current state and proposes unification.

**Root Cause of Token Usage Bug**: `useAgentTokenUsage` expects `SessionEvent` structure but receives `StreamEvent` structure, causing `event.data.tokenUsage` vs `event.data.data.tokenUsage` mismatch.

## Current Event Architectures

**CRITICAL**: We have discovered **FOUR separate, incompatible event architectures**, not three!

### 1. ThreadEvent (Core Persistence Layer)
**Location**: `src/threads/types.ts`  
**Purpose**: Database persistence and core thread operations  
**Structure**:
```typescript
export type ThreadEvent =
  | (BaseThreadEvent & {
      type: 'USER_MESSAGE';
      data: string;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_MESSAGE';
      data: AgentMessageData; // { content: string; tokenUsage?: CombinedTokenUsage }
    })
  // ... more variants

interface BaseThreadEvent {
  id: string;
  threadId: string;
  timestamp: Date;
}
```

**Used By**:
- ThreadManager
- Agent class
- Database persistence
- Conversation building

### 2. StreamEvent (Network/SSE Layer)
**Location**: `src/stream-events/types.ts`  
**Purpose**: Real-time SSE broadcasting via EventStreamManager  
**Structure**:
```typescript
export interface StreamEvent {
  id: string;
  timestamp: Date;
  eventType: StreamEventCategory; // 'session' | 'task' | 'project' | 'global'
  scope: EventScope; // { projectId?, sessionId?, threadId?, taskId? }
  data: SessionEventData | TaskEventData | AgentEventData | ProjectEventData | GlobalEventData;
}

export interface SessionEventData {
  type: 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'AGENT_TOKEN' | ...;
  threadId: ThreadId;
  timestamp: Date;
  data: unknown; // ← Generic payload
}
```

**Used By**:
- EventStreamManager
- Session service broadcasting
- SSE network transport

### 3. SessionEvent (Frontend UI Layer)
**Location**: `packages/web/types/web-sse.ts`  
**Purpose**: Frontend event handling and React state management  
**Structure**:
```typescript
export type SessionEvent =
  | {
      type: 'USER_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: UserMessageEventData;
    }
  | {
      type: 'AGENT_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: AgentMessageData; // { content: string; tokenUsage?: CombinedTokenUsage }
    }
  // ... more variants
```

**Used By**:
- Frontend React hooks (`useAgentTokenUsage`, `useSessionEvents`) 
- UI components expecting specific data shapes
- Input to timeline conversion process

### 4. TimelineEntry (UI/Design System Layer) 
**Location**: `packages/web/types/web-events.ts` + `packages/web/lib/timeline-converter.ts`  
**Purpose**: Timeline UI rendering and design system components  
**Structure**:
```typescript
export interface TimelineEntry {
  id: string;
  type: 'human' | 'ai' | 'tool' | 'admin' | 'system-prompt' | 'user-system-prompt' | 'unknown';
  content: string;
  timestamp: Date;
  agent?: string;
  tool?: string;
  result?: ToolResult;
  metadata?: Record<string, unknown>;
  eventType?: string; // For unknown events
}
```

**Used By**:
- TimelineView React component
- Design system timeline rendering
- UI event display and formatting

**Conversion Process**:
- `convertSessionEventsToTimeline()` - Complex 344-line converter
- Handles streaming token aggregation (`AGENT_TOKEN` → `AGENT_STREAMING`)
- Tool call/result aggregation (`TOOL_CALL` + `TOOL_RESULT` → `TOOL_AGGREGATED`)  
- Event filtering by selected agent
- Chronological sorting and deduplication

**Known Issues**:
Lines 3-5 contain TODO comments acknowledging the architectural problem:
```typescript
// TODO: This adapter exists because we have an impedance mismatch between SessionEvent and TimelineEntry.
// TODO: We should refactor to eliminate this conversion layer - either make TimelineEntry match SessionEvent
// TODO: or standardize on one event format throughout the system to avoid this translation step.
```

## The Type Mismatch Problem

### Current Broken Flow
1. **Agent emits**: `agent_response_complete` with `{ content, tokenUsage }`
2. **Session service creates**: 
   ```typescript
   // session-service.ts:127
   data: {
     type: 'AGENT_MESSAGE',
     threadId,
     timestamp: new Date(),
     data: { content, tokenUsage }, // ← Creates SessionEventData.data
   }
   ```
3. **EventStreamManager wraps**: Into StreamEvent structure
4. **Frontend receives**: 
   ```json
   {
     "data": {
       "type": "AGENT_MESSAGE",
       "threadId": "...",
       "data": {
         "content": "...",
         "tokenUsage": {...} // ← Nested at data.data.tokenUsage
       }
     }
   }
   ```
5. **useAgentTokenUsage expects**: `event.data.tokenUsage` ❌
6. **But tokenUsage is at**: `event.data.data.tokenUsage` ✅

### Specific Bug in Token Usage
**File**: `packages/web/hooks/useAgentTokenUsage.ts:72`
```typescript
// WRONG: Expects SessionEvent structure
if (event.threadId === agentId && event.type === 'AGENT_MESSAGE' && event.data?.tokenUsage) {
  const tokenUsageData = event.data.tokenUsage; // ❌ undefined
}

// SHOULD BE: Handle actual StreamEvent.data.SessionEventData structure  
if (event.threadId === agentId && event.type === 'AGENT_MESSAGE' && event.data?.data?.tokenUsage) {
  const tokenUsageData = event.data.data.tokenUsage; // ✅ works
}
```

## Architectural Problems

### 1. **Quadruple Definition Syndrome**
Same concepts defined four times with different structures:
- Event with type + data + timestamp + thread context
- All represent the same domain concept
- Leads to constant conversion/mapping code

### 2. **Type Safety Breakdown**
- Frontend expects `SessionEvent` but receives `StreamEvent`  
- No compile-time validation of network contract
- Runtime bugs due to structure mismatches

### 3. **Debugging Complexity**
- Three different places to look for event issues
- Different naming conventions (`type` vs `eventType`)
- Different nesting patterns (`data` vs `data.data`)

### 4. **Maintenance Overhead**
- Adding new event types requires changes in 4 places
- Easy to forget updating one layer (timeline-converter is often missed)
- Documentation scattered across multiple files
- Complex conversion logic in timeline-converter.ts (344 lines)

### 5. **Performance Impact**
- Multiple JSON serializations/deserializations
- Unnecessary data wrapping/unwrapping
- Larger network payloads due to nested structures
- Complex timeline conversion processing on every render
- Redundant event filtering and aggregation logic

## Current Workarounds and Hacks

### In Session Service
```typescript
// session-service.ts - Creating SessionEventData wrapper
data: {
  type: 'AGENT_MESSAGE',
  threadId,
  timestamp: new Date(),
  data: { content, tokenUsage }, // Extra wrapping layer
}
```

### In Frontend Hooks
```typescript
// Multiple hooks creating separate useEventStream connections
// causing potential conflicts and duplicate connections
useEventStream({
  threadIds: [agentId],
  onAgentMessage: handleAgentMessage,
});
```

### In Timeline Processing
```typescript
// timeline-converter.ts - 344-line conversion layer
export function convertSessionEventsToTimeline(
  events: SessionEvent[],
  context: ConversionContext
): TimelineEntry[]

// TODO comments acknowledging architectural debt:
// "This adapter exists because we have an impedance mismatch between SessionEvent and TimelineEntry"
// "We should refactor to eliminate this conversion layer"

// Complex processing pipeline:
// 1. Filter events by agent
// 2. Process streaming tokens (AGENT_TOKEN → AGENT_STREAMING)
// 3. Aggregate tool calls (TOOL_CALL + TOOL_RESULT → TOOL_AGGREGATED)  
// 4. Convert to TimelineEntry format
// 5. Sort chronologically
```

## Impact Assessment

### Current Bugs Caused by This Architecture
1. **Token usage not updating** - Primary issue that led to this investigation
2. **Event handler conflicts** - Multiple useEventStream connections competing  
3. **Type errors in timeline conversion** - Structure mismatches across 4 layers
4. **Debugging difficulties** - Event tracing across 4 separate systems
5. **Timeline rendering inconsistencies** - Event processing edge cases in converter
6. **Performance issues** - Complex conversion logic on every UI update

### Developer Experience Issues
- New developers confused by **four** separate event systems
- Difficult to add new event types consistently across all layers
- Type errors that aren't caught until runtime
- Complex mental model for event flow through 4 conversion layers
- Timeline converter is frequently overlooked when adding event types
- TODO comments indicate known architectural debt

## Proposed Solutions

### Option 1: Frontend Adapter Pattern (Quick Fix)
**Effort**: Low  
**Risk**: Low  
**Approach**: Create adapter layer in frontend to transform StreamEvent → SessionEvent

```typescript
// Event adapter
function streamEventToSessionEvent(streamEvent: StreamEvent): SessionEvent | null {
  if (isSessionEvent(streamEvent)) {
    return {
      type: streamEvent.data.type,
      threadId: streamEvent.data.threadId, 
      timestamp: streamEvent.data.timestamp,
      data: streamEvent.data.data // Unwrap the extra layer
    };
  }
  return null;
}
```

**Pros**: Quick fix, minimal risk  
**Cons**: Adds more complexity, doesn't solve root cause

### Option 2: Unified Event Architecture (Proper Fix)
**Effort**: High  
**Risk**: Medium  
**Approach**: Design single canonical event system

```typescript
// Unified Event Architecture
export interface UnifiedEvent {
  id: string;
  timestamp: Date;
  source: 'core' | 'network' | 'ui'; // Layer tracking
  
  // Core event data
  type: EventType;
  threadId: ThreadId;
  data: EventData;
  
  // Routing/filtering context
  scope: {
    projectId?: string;
    sessionId?: string;
    taskId?: string;
  };
  
  // Metadata
  metadata?: {
    retryCount?: number;
    processingTime?: number;
    correlation?: string;
  };
}
```

**Pros**: Clean architecture, type safety, easier maintenance, eliminates 4-way conversion  
**Cons**: Large refactoring effort, migration complexity, timeline-converter.ts needs complete rewrite

### Option 3: Gradual Migration (Hybrid)
**Effort**: Medium  
**Risk**: Medium  
**Approach**: Start with core events, migrate layers incrementally

1. **Phase 1**: Unify ThreadEvent + SessionEventData → CoreEvent
2. **Phase 2**: Create conversion layer StreamEvent ↔ CoreEvent  
3. **Phase 3**: Migrate frontend SessionEvent to use CoreEvent directly
4. **Phase 4**: Rewrite timeline-converter to use CoreEvent input
5. **Phase 5**: Remove legacy SessionEvent and TimelineEntry types

## Recommended Action Plan

### Immediate (This Sprint)
1. **Quick Fix**: Update `useAgentTokenUsage` to handle StreamEvent structure
2. **Documentation**: Complete this analysis document
3. **Audit**: Catalog all event-related bugs and inefficiencies

### Near Term (Next 2-3 Sprints)
1. **Design**: Unified event architecture specification
2. **Prototype**: Core event types and conversion utilities
3. **Migration Plan**: Detailed step-by-step refactoring approach

### Long Term (Next Quarter)
1. **Execute**: Gradual migration to unified architecture
2. **Validation**: Comprehensive testing of event flows
3. **Documentation**: Updated architecture guides
4. **Performance**: Measure improvements in event processing

## Success Metrics

### Technical Debt Reduction
- [ ] Single event type definition (eliminate 4 architectures)
- [ ] Zero runtime type mismatches in event handling
- [ ] 100% compile-time validation of event contracts
- [ ] Eliminate timeline-converter.ts completely

### Developer Experience
- [ ] Single mental model for events across all layers
- [ ] New event types require changes in only 1 place
- [ ] Event flow debugging takes <5 minutes

### Performance
- [ ] Reduce event processing latency by 30%
- [ ] Eliminate redundant JSON serializations
- [ ] Smaller SSE payloads (remove nested wrappers)

### Bug Resolution
- [ ] Token usage updates work consistently
- [ ] No event handler conflicts
- [ ] Timeline rendering handles all event types correctly

## Risk Mitigation

### Migration Risks
- **Breaking Changes**: Use feature flags for gradual rollout
- **Data Loss**: Comprehensive backup/restore testing
- **Performance**: Load testing during migration phases

### Compatibility
- **API Contracts**: Maintain backward compatibility with versioning
- **Database**: Use migrations for any schema changes
- **Frontend**: Progressive enhancement approach

## Conclusion

The current **four-way event architecture split** is causing real bugs (token usage), developer confusion, and massive maintenance overhead. We have ThreadEvent, StreamEvent, SessionEvent, AND TimelineEntry - each with different structures and complex conversion logic.

The 344-line `timeline-converter.ts` file literally contains TODO comments acknowledging this architectural debt. While a quick fix can address the immediate token usage issue, the underlying architectural debt needs systematic resolution.

**Recommendation**: Implement quick fix now, plan unified architecture for next quarter. This gives us working functionality while addressing the technical debt properly.

The investment in unified event architecture will pay dividends in:
- Reduced debugging time (4 systems → 1 system)
- Faster feature development (no more 4-way updates)
- Better type safety (compile-time validation)
- Improved performance (eliminate conversion overhead)
- Cleaner mental model (single event flow)
- Remove timeline-converter.ts entirely

This is a classic case where "perfect is the enemy of good" - but in this case, the current "good" is actively causing bugs, performance issues, and developer pain across four separate systems.