# Unified Event Architecture - Balanced Approach

## The Real Problem
1. StreamEvent wraps events causing `data.data.tokenUsage` nesting
2. 344-line timeline-converter.ts 
3. Some events are persisted (ThreadEvent), others are transient (UI events)

## The Solution: Extend ThreadEvent for All Events

### 1. Make ThreadEvent the Universal Event Type

```typescript
// src/threads/types.ts

// Add transient event types to the union
export type ThreadEventType = 
  // Existing persisted events
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE' 
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'TOOL_APPROVAL_REQUEST'
  | 'TOOL_APPROVAL_RESPONSE'
  | 'SYSTEM_PROMPT'
  | 'USER_SYSTEM_PROMPT'
  | 'COMPACTION'
  // Add transient events
  | 'AGENT_TOKEN'           // Streaming chunks
  | 'AGENT_STREAMING'        // Aggregated streaming
  | 'AGENT_STATE_CHANGE'     // UI state updates
  | 'CONNECTION_ERROR'       // Network issues
  | 'TASK_UPDATE';           // Task events

// Mark which events shouldn't be persisted
export interface ThreadEvent {
  id: string;
  type: ThreadEventType;
  threadId: string;
  timestamp: Date;
  data: ThreadEventData;
  
  // New field to handle transient events
  transient?: boolean; // Don't persist to DB
  
  // Optional context for routing (replaces StreamEvent scope)
  context?: {
    sessionId?: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
  };
}
```

### 2. Remove StreamEvent Wrapper

**DELETE:** `src/stream-events/types.ts`

**CHANGE:**
```typescript
// src/sessions/session-service.ts

// BEFORE - Double wrapped:
this.eventStreamManager.broadcast({
  eventType: 'session',
  scope: { sessionId },
  data: {
    type: 'AGENT_MESSAGE',
    threadId,
    timestamp,
    data: { content, tokenUsage } // data.data!
  }
});

// AFTER - Direct ThreadEvent:
this.eventStreamManager.broadcast({
  type: 'AGENT_MESSAGE',
  threadId,
  timestamp: new Date(),
  data: { content, tokenUsage }, // Direct!
  context: { sessionId }
});
```

### 3. ThreadManager Handles Persistence Flag

```typescript
// src/threads/thread-manager.ts
async addEvent(event: ThreadEvent): Promise<void> {
  // Only persist non-transient events
  if (!event.transient) {
    await this.persistence.addEvent(event);
  }
  
  // Always broadcast for real-time updates
  this.emit('event', event);
}
```

### 4. Frontend Uses ThreadEvent Directly

```typescript
// packages/web/types/web-sse.ts
export type SessionEvent = ThreadEvent; // That's it!

// packages/web/hooks/useAgentTokenUsage.ts
// Direct access - no more data.data!
if (event.type === 'AGENT_MESSAGE' && event.data?.tokenUsage) {
  const tokenUsage = event.data.tokenUsage; // Works!
}
```

### 5. Delete Timeline Converter

**DELETE:** `packages/web/lib/timeline-converter.ts` (344 lines)

**REPLACE:**
```typescript
// packages/web/components/timeline.tsx
function Timeline({ events }: { events: ThreadEvent[] }) {
  // Filter out transient events we don't want in timeline
  const timelineEvents = events.filter(e => 
    !['AGENT_TOKEN', 'CONNECTION_ERROR'].includes(e.type)
  );
  
  return (
    <>
      {timelineEvents.map(event => (
        <EventRenderer key={event.id} event={event} />
      ))}
    </>
  );
}

function EventRenderer({ event }: { event: ThreadEvent }) {
  switch (event.type) {
    case 'USER_MESSAGE':
      return <UserMessage content={event.data} />;
    case 'AGENT_MESSAGE':
      return <AgentMessage 
        content={event.data.content}
        tokenUsage={event.data.tokenUsage} // Direct!
      />;
    case 'TOOL_CALL':
      return <ToolCall {...event.data} />;
    case 'AGENT_STREAMING':
      return <StreamingMessage content={event.data.content} />;
    // etc...
  }
}
```

## Implementation Plan (3 Days)

### Day 1: Extend ThreadEvent
1. Add transient event types to ThreadEventType union
2. Add `transient` and `context` fields to ThreadEvent
3. Update ThreadManager to check transient flag
4. Create migration for any new event types

### Day 2: Remove Wrappers
1. Delete StreamEvent and all wrapping functions
2. Update session-service to send ThreadEvent directly
3. Fix all event broadcasting to use ThreadEvent
4. Update EventStreamManager to handle ThreadEvent

### Day 3: Fix Frontend
1. Change SessionEvent to alias ThreadEvent
2. Fix useAgentTokenUsage (data.tokenUsage not data.data.tokenUsage)
3. Delete timeline-converter.ts
4. Update Timeline component to render ThreadEvent directly

## What Gets Deleted
- StreamEvent types (~200 lines)
- Timeline converter (344 lines)
- Event wrapping functions (~100 lines)
- Total: ~650 lines removed

## What's Added
- 10 lines for new event types
- `transient` and `context` fields
- Total: ~30 lines added

## Why This Works
1. **Single event type** - ThreadEvent everywhere
2. **No wrapping** - Fixes data.data.tokenUsage bug
3. **Handles all cases** - Both persisted and transient events
4. **Simple persistence logic** - Just check `transient` flag
5. **Direct rendering** - No conversion needed

## Not Included (YAGNI)
- Event factories
- Correlation IDs
- Sequence numbers
- Metadata objects
- Complex migration utilities

Just extend what exists to handle all cases, then delete the wrappers.