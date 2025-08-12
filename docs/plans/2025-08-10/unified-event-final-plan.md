# Unified Event Architecture - Final Plan

## Core Decisions

1. **One Event Type**: All events use a single `LaceEvent` type (renamed from ThreadEvent)
2. **Optional threadId**: Thread events have `threadId`, system/task/project events don't
3. **Persistence Logic**: Events with `threadId` can be persisted (unless marked transient), events without `threadId` are always transient
4. **ThreadManager Stays**: Keeps its name and role, handles both thread events and pass-through for non-thread events
5. **No Factories/Options**: Direct object creation with TypeScript ensuring correctness

## The New Event Type

```typescript
// src/events/types.ts (rename from src/threads/types.ts)

export interface LaceEvent {
  id: string;
  type: LaceEventType;
  timestamp: Date;
  data: LaceEventData;
  
  // Thread events have threadId
  threadId?: string;
  
  // Routing/context  
  context?: {
    sessionId?: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
  };
  
  // Transient flag (some event types are always transient)
  transient?: boolean;
}

export type LaceEventType = 
  // Thread events (persisted if threadId present)
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'TOOL_APPROVAL_REQUEST'
  | 'TOOL_APPROVAL_RESPONSE'
  | 'LOCAL_SYSTEM_MESSAGE'
  | 'SYSTEM_PROMPT'
  | 'USER_SYSTEM_PROMPT'
  | 'COMPACTION'
  
  // Always transient (even with threadId)
  | 'AGENT_TOKEN'
  | 'AGENT_STREAMING'
  | 'AGENT_STATE_CHANGE'
  | 'COMPACTION_START'
  | 'COMPACTION_COMPLETE'
  
  // Non-thread events (no threadId, always transient)
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'AGENT_SPAWNED'
  | 'AGENT_STOPPED'
  | 'SYSTEM_NOTIFICATION';
```

## Updated ThreadManager

```typescript
// src/threads/thread-manager.ts

class ThreadManager {
  addEvent(event: LaceEvent): LaceEvent | null {
    // Fill in defaults
    if (!event.id) event.id = generateEventId();
    if (!event.timestamp) event.timestamp = new Date();
    
    // Non-thread events pass through
    if (!event.threadId) {
      return event; // Caller will broadcast
    }
    
    // Thread events
    const thread = this.getThread(event.threadId);
    if (!thread) {
      throw new Error(`Thread ${event.threadId} not found`);
    }
    
    // Determine if transient (by type or flag)
    const isTransient = event.transient || isTransientType(event.type);
    
    if (isTransient) {
      thread.events.push(event);
      thread.updatedAt = new Date();
      return event;
    }
    
    // Persist non-transient thread events
    return this._persistence.transaction(() => {
      const wasSaved = this._persistence.saveEvent(event);
      if (wasSaved) {
        thread.events.push(event);
        thread.updatedAt = new Date();
        return event;
      }
      return null;
    });
  }
}

function isTransientType(type: LaceEventType): boolean {
  return [
    'AGENT_TOKEN',
    'AGENT_STREAMING', 
    'AGENT_STATE_CHANGE',
    'COMPACTION_START',
    'COMPACTION_COMPLETE'
  ].includes(type);
}
```

## Implementation Steps

### Phase 1: Update Types (COMPLETED)
- ✅ Extended ThreadEvent with transient events
- ✅ Added transient and context fields
- ✅ Updated ThreadManager.addEvent to handle transient flag

### Phase 2: Rename and Refactor
1. Rename `ThreadEvent` → `LaceEvent` everywhere
2. Move types from `src/threads/types.ts` to `src/events/types.ts`
3. Add non-thread event types (TASK_*, PROJECT_*, etc.)
4. Update ThreadManager.addEvent to handle non-thread events

### Phase 3: Update All Event Creators
Replace all 114 calls from:
```typescript
threadManager.addEvent(threadId, 'USER_MESSAGE', content)
```

To:
```typescript
threadManager.addEvent({
  type: 'USER_MESSAGE',
  threadId,
  data: content
})
```

For transient events:
```typescript
threadManager.addEvent({
  type: 'AGENT_TOKEN',
  threadId,
  data: { token },
  transient: true  // Or rely on isTransientType()
})
```

For non-thread events:
```typescript
threadManager.addEvent({
  type: 'TASK_CREATED',
  data: taskData,
  context: { projectId, taskId }
  // No threadId - always transient
})
```

### Phase 4: Delete StreamEvent
1. Delete `src/stream-events/` directory
2. Update session-service to create LaceEvents directly
3. Update EventStreamManager to broadcast LaceEvents
4. Remove all StreamEvent wrapping/unwrapping

### Phase 5: Update Frontend
1. Change `SessionEvent` to alias `LaceEvent`
2. Fix token usage access (data.tokenUsage not data.data.tokenUsage)
3. Update all hooks to expect LaceEvent

### Phase 6: Delete Timeline Converter
1. Create direct timeline renderer that consumes LaceEvent
2. Delete `packages/web/lib/timeline-converter.ts` (344 lines)
3. Update Timeline component to render events directly

### Phase 7: Clean Up
1. Search and fix any remaining `data.data` patterns
2. Remove any StreamEvent references
3. Update imports
4. Run all tests

## Key Changes from Original Plan

1. **LaceEvent not ThreadEvent**: Better name for unified system
2. **Optional threadId**: Not all events belong to threads
3. **ThreadManager handles all events**: Pass-through for non-thread events
4. **Event type determines behavior**: Some types always transient
5. **No event factories**: Direct object creation
6. **Simpler migration**: Most call sites just need minor updates

## Success Metrics

- ✅ One event type everywhere
- ✅ No more data.data.tokenUsage nesting
- ✅ 344-line timeline converter deleted
- ✅ StreamEvent wrapper deleted
- ✅ ~650 lines of code removed
- ✅ Direct event flow: create → persist/broadcast → consume