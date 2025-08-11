# Unified Event Architecture - Direct Migration Plan

## Overview
Direct migration: Extend ThreadEvent, delete wrappers, fix consumers. No compatibility, no adapters.

## Phase 1: Extend ThreadEvent Type

### Step 1.1: Add All Event Types
**File:** `src/threads/types.ts`

```typescript
// ADD to ThreadEventType union:
export type ThreadEventType = 
  // ... existing types ...
  | 'AGENT_TOKEN'
  | 'AGENT_STREAMING'  
  | 'AGENT_STATE_CHANGE'
  | 'CONNECTION_ERROR'
  | 'TASK_UPDATE';

// ADD to BaseThreadEvent:
export interface BaseThreadEvent {
  id: string;
  threadId: string;
  timestamp: Date;
  transient?: boolean;  // Don't persist to DB
  context?: {
    sessionId?: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
  };
}

// ADD new data types and extend ThreadEvent union for each new type
```

### Step 1.2: Update ThreadManager
**File:** `src/threads/thread-manager.ts`

```typescript
async addEvent(event: ThreadEvent): Promise<void> {
  // Only persist non-transient events
  if (!event.transient) {
    await this.persistence.addEvent(event);
  }
  
  // Always emit for real-time
  this.emit('event', event);
}
```

## Phase 2: Delete StreamEvent and Fix All Producers

### Step 2.1: Update Session Service
**File:** `src/sessions/session-service.ts`

```typescript
// DELETE all StreamEvent imports
// DELETE all createSessionEvent, createTaskEvent functions

// CHANGE every event emission from:
this.eventStreamManager.broadcast({
  eventType: 'session',
  scope: { sessionId },
  data: {
    type: 'AGENT_MESSAGE',
    threadId,
    data: { content, tokenUsage }  // nested!
  }
});

// TO:
const event: ThreadEvent = {
  id: generateId(),
  type: 'AGENT_MESSAGE',
  threadId,
  timestamp: new Date(),
  data: { content, tokenUsage },  // flat!
  context: { sessionId }
};
this.eventStreamManager.broadcast(event);
```

### Step 2.2: Update EventStreamManager
**File:** `src/sessions/event-stream-manager.ts` (or wherever)

```typescript
// CHANGE broadcast signature from:
broadcast(event: StreamEvent): void

// TO:
broadcast(event: ThreadEvent): void {
  // Send ThreadEvent directly over SSE
  const sessionId = event.context?.sessionId;
  if (sessionId) {
    const connections = this.connections.get(sessionId);
    connections?.forEach(res => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  }
}
```

### Step 2.3: Delete StreamEvent Files
```bash
rm -rf src/stream-events/
```

## Phase 3: Fix All Frontend Consumers

### Step 3.1: Update Type Imports
**File:** `packages/web/types/web-sse.ts`

```typescript
// DELETE everything and replace with:
import type { ThreadEvent } from '@/../../src/threads/types';
export type SessionEvent = ThreadEvent;
```

### Step 3.2: Fix Token Usage Hook
**File:** `packages/web/hooks/useAgentTokenUsage.ts`

```typescript
// CHANGE:
if (event.data?.data?.tokenUsage) {
  const tokenUsage = event.data.data.tokenUsage;

// TO:
if (event.data?.tokenUsage) {
  const tokenUsage = event.data.tokenUsage;
```

### Step 3.3: Update All Event Hooks
**Files:** All files in `packages/web/hooks/`

```typescript
// Update type imports
import type { ThreadEvent } from '@/../../src/threads/types';

// Update all event handlers to expect ThreadEvent
```

## Phase 4: Delete Timeline Converter

### Step 4.1: Create Direct Renderer
**File:** `packages/web/components/timeline.tsx`

```typescript
import type { ThreadEvent } from '@/../../src/threads/types';

export function Timeline({ events }: { events: ThreadEvent[] }) {
  const visibleEvents = events.filter(e => 
    !e.transient || e.type === 'AGENT_STREAMING'
  );
  
  return (
    <>
      {visibleEvents.map(event => {
        switch (event.type) {
          case 'USER_MESSAGE':
            return <UserMessage key={event.id} content={event.data} />;
          case 'AGENT_MESSAGE':
            return <AgentMessage 
              key={event.id}
              content={event.data.content}
              tokenUsage={event.data.tokenUsage}
            />;
          case 'TOOL_CALL':
            return <ToolCall key={event.id} {...event.data} />;
          case 'TOOL_RESULT':
            return <ToolResult key={event.id} {...event.data} />;
          default:
            return null;
        }
      })}
    </>
  );
}
```

### Step 4.2: Update Timeline Usage
**File:** Find where Timeline is used

```typescript
// DELETE:
import { convertSessionEventsToTimeline } from '@/lib/timeline-converter';
const entries = convertSessionEventsToTimeline(events);

// Just use events directly:
<Timeline events={events} />
```

### Step 4.3: Delete Converter
```bash
rm packages/web/lib/timeline-converter.ts
rm packages/web/lib/timeline-converter.test.ts
```

## Phase 5: Clean Up

### Step 5.1: Delete Unused Types
```bash
rm packages/web/types/web-events.ts  # TimelineEntry
```

### Step 5.2: Search and Destroy
```bash
# Find any remaining data.data patterns
grep -r "data\.data" src/ packages/

# Find any remaining StreamEvent references  
grep -r "StreamEvent" src/ packages/

# Find any timeline-converter references
grep -r "timeline-converter" packages/
```

### Step 5.3: Fix Any Remaining Issues
Based on grep results, fix any remaining references.

## Phase 6: Test Everything

### Step 6.1: Run Tests
```bash
npm run test:run
cd packages/web && npm run test:run
```

### Step 6.2: Fix Broken Tests
Tests will likely fail due to changed event structures. Update test fixtures to use ThreadEvent format.

### Step 6.3: Manual Testing
- [ ] Send user message
- [ ] Receive agent response  
- [ ] Token usage displays (no data.data!)
- [ ] Tools execute
- [ ] Streaming works
- [ ] No console errors

## File Change Summary

### Files to Modify (~15 files)
```
src/threads/types.ts                      # Add event types
src/threads/thread-manager.ts             # Handle transient flag
src/sessions/session-service.ts           # Emit ThreadEvent
src/sessions/event-stream-manager.ts      # Broadcast ThreadEvent
src/agents/agent.ts                       # Emit ThreadEvent
packages/web/types/web-sse.ts            # Alias to ThreadEvent
packages/web/hooks/useAgentTokenUsage.ts # Fix data.tokenUsage
packages/web/hooks/useEventStream.ts     # Use ThreadEvent
packages/web/hooks/useSessionEvents.ts   # Use ThreadEvent
packages/web/components/timeline.tsx     # Direct rendering
```

### Files to Delete (~10 files)
```
src/stream-events/                       # Entire directory
packages/web/lib/timeline-converter.ts   # 344 lines gone
packages/web/lib/timeline-converter.test.ts
packages/web/types/web-events.ts        # TimelineEntry type
```

## Timeline

**Day 1 Morning:**
- Phase 1: Extend ThreadEvent (1 hour)
- Phase 2: Delete StreamEvent, fix producers (2 hours)

**Day 1 Afternoon:**
- Phase 3: Fix frontend consumers (2 hours)
- Phase 4: Delete timeline converter (2 hours)

**Day 2 Morning:**
- Phase 5: Clean up (1 hour)
- Phase 6: Test and fix (3 hours)

**Total: ~11 hours**

## Why This Works

1. **No compatibility layer** - Direct replacement
2. **No adapters** - Just change types and delete wrappers
3. **No gradual migration** - All or nothing
4. **Simpler than compatibility approach** - Less code, less complexity

## Success Metrics

- ✅ `data/.data.tokenUsage` → `data.tokenUsage` 
- ✅ StreamEvent deleted
- ✅ timeline-converter.ts deleted (344 lines)
- ✅ One event type everywhere (ThreadEvent)
- ✅ ~650 lines deleted, ~30 added