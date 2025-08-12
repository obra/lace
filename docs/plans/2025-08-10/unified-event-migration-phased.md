# Unified Event Migration - Phased Implementation

## Phase 1: Extend ThreadEvent Type (COMPLETED ✅)
- ✅ Added transient event types to EVENT_TYPES
- ✅ Added transient and context fields to BaseThreadEvent  
- ✅ Added data types for new events (AgentTokenData, etc.)
- ✅ Extended ThreadEvent union with new event types
- ✅ Updated ThreadManager.addEvent to:
  - Take full ThreadEvent object
  - Handle non-thread events (pass-through)
  - Check transient flag and event type
  - Skip persistence for transient events

## Phase 2: Update All Event Producers (~4 hours)

### Step 2.1: Update all ThreadManager.addEvent calls
**114 call sites need updating from:**
```typescript
threadManager.addEvent(threadId, 'USER_MESSAGE', content)
```
**To:**
```typescript
threadManager.addEvent({
  type: 'USER_MESSAGE',
  threadId,
  data: content
})
```

**Files with most calls:**
- src/agents/agent.ts
- src/interfaces/*.ts
- src/threads/*.test.ts
- packages/web/lib/server/session-service.ts

### Step 2.2: Update Agent to create events properly
- Update all event creation in agent.ts
- Add context fields where needed
- Mark streaming events as transient

### Step 2.3: Update Session Service
- Create ThreadEvents directly (no StreamEvent wrapper)
- Include context for routing
- Handle both thread and non-thread events

## Phase 3: Delete StreamEvent (~2 hours)

### Step 3.1: Update EventStreamManager
**Change from:**
```typescript
broadcast(event: StreamEvent)
```
**To:**
```typescript
broadcast(event: ThreadEvent)
```

### Step 3.2: Remove StreamEvent wrapping
- Delete all createSessionEvent, createTaskEvent functions
- Update all places that create StreamEvents

### Step 3.3: Delete StreamEvent files
```bash
rm -rf src/stream-events/
```

## Phase 4: Fix Frontend Consumers (~2 hours)

### Step 4.1: Update SessionEvent type
**File:** `packages/web/types/web-sse.ts`
```typescript
import type { ThreadEvent } from '@/../../src/threads/types';
export type SessionEvent = ThreadEvent;
```

### Step 4.2: Fix token usage access
**File:** `packages/web/hooks/useAgentTokenUsage.ts`
```typescript
// FROM: event.data?.data?.tokenUsage
// TO:   event.data?.tokenUsage
```

### Step 4.3: Update all event hooks
- useEventStream.ts
- useSessionEvents.ts
- Any other event consumers

## Phase 5: Delete Timeline Converter (~2 hours)

### Step 5.1: Create direct renderer
**File:** `packages/web/components/timeline.tsx`
```typescript
function Timeline({ events }: { events: ThreadEvent[] }) {
  const visibleEvents = events.filter(e => 
    !e.transient || ['AGENT_STREAMING'].includes(e.type)
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
          // ... etc
        }
      })}
    </>
  );
}
```

### Step 5.2: Update Timeline usage
- Find all imports of timeline-converter
- Replace with direct event rendering

### Step 5.3: Delete converter
```bash
rm packages/web/lib/timeline-converter.ts
rm packages/web/lib/timeline-converter.test.ts
```

## Phase 6: Rename ThreadEvent to LaceEvent (~1 hour)

### Step 6.1: Rename types
- ThreadEvent → LaceEvent
- ThreadEventType → LaceEventType
- ThreadEventData → LaceEventData

### Step 6.2: Move files
```bash
mv src/threads/types.ts src/events/types.ts
```

### Step 6.3: Update all imports
- Global find/replace ThreadEvent → LaceEvent
- Update import paths

## Phase 7: Add Non-Thread Event Types (~1 hour)

### Step 7.1: Add event types
```typescript
// Add to LaceEventType:
| 'TASK_CREATED'
| 'TASK_UPDATED'
| 'TASK_DELETED'
| 'PROJECT_CREATED'
| 'PROJECT_UPDATED'
| 'AGENT_SPAWNED'
| 'AGENT_STOPPED'
| 'SYSTEM_NOTIFICATION'
```

### Step 7.2: Add data types
```typescript
export interface TaskEventData {
  taskId: string;
  task?: Task;
  action: 'created' | 'updated' | 'deleted';
}
// ... etc
```

### Step 7.3: Update task/project services
- Create LaceEvents for task operations
- Create LaceEvents for project operations
- No threadId, always transient

## Phase 8: Testing and Validation (~2 hours)

### Step 8.1: Fix broken tests
- Update test fixtures to use new event format
- Fix any type errors

### Step 8.2: Run test suites
```bash
npm run test:run
cd packages/web && npm run test:run
npm run test:e2e
```

### Step 8.3: Manual testing
- [ ] User messages work
- [ ] Agent responses show
- [ ] Token usage displays correctly
- [ ] Tools execute
- [ ] Streaming works
- [ ] Timeline renders correctly
- [ ] No console errors

### Step 8.4: Search for stragglers
```bash
grep -r "data\.data" src/ packages/
grep -r "StreamEvent" src/ packages/
grep -r "timeline-converter" packages/
grep -r "addEvent.*,.*," src/  # Old 3-param signature
```

## Total Estimated Time: ~16 hours

## Files to Delete (Final Count)
- src/stream-events/ (entire directory)
- packages/web/lib/timeline-converter.ts
- packages/web/lib/timeline-converter.test.ts
- packages/web/types/web-events.ts (TimelineEntry type)

## Lines of Code Impact
- ~650 lines deleted
- ~50 lines added
- Net: ~600 lines removed