# Unified Event Architecture - Iterative Migration Plan

## Overview
Migrate from 4 event systems to 1 by extending ThreadEvent to handle all cases, removing wrappers, and eliminating converters.

## Phase 1: Extend ThreadEvent Type (Keep Everything Working)

### Step 1.1: Add New Event Types to Union
**File:** `src/threads/types.ts`

```typescript
// ADD these to the ThreadEventType union:
export type ThreadEventType = 
  // ... existing types ...
  | 'AGENT_TOKEN'           // Streaming token chunks
  | 'AGENT_STREAMING'        // Aggregated streaming content  
  | 'AGENT_STATE_CHANGE'     // Agent state updates
  | 'CONNECTION_ERROR'       // Network/connection issues
  | 'CONNECTION_SUCCESS'     // Connection restored
  | 'TASK_UPDATE'           // Task status changes
  | 'TASK_CREATED'          // New task
  | 'TASK_COMPLETED';       // Task done
```

### Step 1.2: Add Transient and Context Fields
**File:** `src/threads/types.ts`

```typescript
// MODIFY BaseThreadEvent interface:
export interface BaseThreadEvent {
  id: string;
  threadId: string;
  timestamp: Date;
  
  // ADD these new fields:
  transient?: boolean;  // If true, don't persist to DB
  context?: {
    sessionId?: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
  };
}
```

### Step 1.3: Add Data Types for New Events
**File:** `src/threads/types.ts`

```typescript
// ADD these data interfaces:
export interface AgentTokenData {
  partial: string;
  tokenCount?: number;
}

export interface AgentStreamingData {
  content: string;
  isComplete: boolean;
}

export interface AgentStateChangeData {
  oldState: string;
  newState: string;
  reason?: string;
}

export interface ConnectionErrorData {
  error: string;
  code?: string;
  retryable?: boolean;
}

export interface TaskUpdateData {
  taskId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
}

// UPDATE the ThreadEvent union to include new event types:
export type ThreadEvent =
  // ... existing event types ...
  | (BaseThreadEvent & {
      type: 'AGENT_TOKEN';
      data: AgentTokenData;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_STREAMING';
      data: AgentStreamingData;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_STATE_CHANGE';
      data: AgentStateChangeData;
    })
  // ... etc for other new types
```

### Step 1.4: Update ThreadManager to Handle Transient Flag
**File:** `src/threads/thread-manager.ts`

```typescript
// MODIFY addEvent method:
async addEvent(event: ThreadEvent): Promise<void> {
  // Only persist non-transient events
  if (!event.transient) {
    await this.persistence.addEvent(event);
  }
  
  // Always emit for real-time updates
  this.emit('event', event);
  
  // If it has context, also emit scoped events
  if (event.context?.sessionId) {
    this.emit(`session:${event.context.sessionId}:event`, event);
  }
}
```

### Step 1.5: Run Tests
```bash
npm run test:unit src/threads
```

**Expected:** All existing tests pass. New event types don't break anything.

## Phase 2: Create Compatibility Layer (Parallel Running)

### Step 2.1: Create Adapter for StreamEvent → ThreadEvent
**File:** `src/events/stream-adapter.ts` (NEW)

```typescript
import type { StreamEvent } from '../stream-events/types';
import type { ThreadEvent } from '../threads/types';

export function streamEventToThreadEvent(streamEvent: StreamEvent): ThreadEvent | null {
  // Handle session events (the most common)
  if (streamEvent.eventType === 'session' && streamEvent.data) {
    const sessionData = streamEvent.data as any;
    
    // Extract the actual event from the wrapper
    if (sessionData.type && sessionData.data) {
      return {
        id: streamEvent.id,
        type: sessionData.type,
        threadId: sessionData.threadId || '',
        timestamp: streamEvent.timestamp,
        data: sessionData.data, // Unwrap data.data!
        transient: isTransientEventType(sessionData.type),
        context: {
          sessionId: streamEvent.scope?.sessionId,
          projectId: streamEvent.scope?.projectId,
          taskId: streamEvent.scope?.taskId,
        }
      };
    }
  }
  
  // Handle task events
  if (streamEvent.eventType === 'task') {
    return {
      id: streamEvent.id,
      type: 'TASK_UPDATE',
      threadId: '', // Tasks might not have threads
      timestamp: streamEvent.timestamp,
      data: streamEvent.data,
      transient: true,
      context: {
        taskId: streamEvent.scope?.taskId,
        sessionId: streamEvent.scope?.sessionId,
      }
    };
  }
  
  return null;
}

function isTransientEventType(type: string): boolean {
  return ['AGENT_TOKEN', 'AGENT_STREAMING', 'AGENT_STATE_CHANGE', 
          'CONNECTION_ERROR', 'CONNECTION_SUCCESS'].includes(type);
}
```

### Step 2.2: Update EventStreamManager to Support Both
**File:** `src/sessions/event-stream-manager.ts` (or wherever it is)

```typescript
// ADD method to broadcast ThreadEvent directly:
broadcastThreadEvent(sessionId: string, event: ThreadEvent): void {
  const connections = this.connections.get(sessionId);
  if (connections) {
    connections.forEach(res => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  }
}

// KEEP existing broadcast method for now (compatibility)
broadcast(event: StreamEvent): void {
  // existing implementation
}
```

### Step 2.3: Test Adapter
**File:** `src/events/stream-adapter.test.ts` (NEW)

```typescript
describe('streamEventToThreadEvent', () => {
  it('should unwrap nested data.data structure', () => {
    const streamEvent = {
      id: '123',
      eventType: 'session',
      timestamp: new Date(),
      scope: { sessionId: 'session-1' },
      data: {
        type: 'AGENT_MESSAGE',
        threadId: 'thread-1',
        data: {
          content: 'Hello',
          tokenUsage: { prompt: 10, completion: 20 }
        }
      }
    };
    
    const threadEvent = streamEventToThreadEvent(streamEvent);
    
    expect(threadEvent?.data).toEqual({
      content: 'Hello',
      tokenUsage: { prompt: 10, completion: 20 }
    });
    // Not nested!
    expect(threadEvent?.data.data).toBeUndefined();
  });
});
```

## Phase 3: Update Session Service (Stop Creating StreamEvents)

### Step 3.1: Change Agent Message Broadcasting
**File:** `src/sessions/session-service.ts`

```typescript
// FIND this pattern:
private handleAgentMessage(agentId: string, data: any) {
  const streamEvent = {
    eventType: 'session',
    scope: { sessionId: this.sessionId },
    data: {
      type: 'AGENT_MESSAGE',
      threadId: agentId,
      timestamp: new Date(),
      data: { content: data.content, tokenUsage: data.tokenUsage }
    }
  };
  this.eventStreamManager.broadcast(streamEvent);
}

// REPLACE with:
private handleAgentMessage(agentId: string, data: any) {
  const threadEvent: ThreadEvent = {
    id: generateId(),
    type: 'AGENT_MESSAGE',
    threadId: agentId,
    timestamp: new Date(),
    data: { content: data.content, tokenUsage: data.tokenUsage }, // Direct!
    context: { sessionId: this.sessionId, agentId }
  };
  this.eventStreamManager.broadcastThreadEvent(this.sessionId, threadEvent);
}
```

### Step 3.2: Update All Event Emissions
**File:** `src/sessions/session-service.ts`

For each event type being created:
- USER_MESSAGE
- TOOL_CALL
- TOOL_RESULT
- TOOL_APPROVAL_REQUEST
- TOOL_APPROVAL_RESPONSE
- AGENT_TOKEN
- AGENT_STREAMING
- AGENT_STATE_CHANGE

Change from StreamEvent creation to direct ThreadEvent.

### Step 3.3: Test Session Service
```bash
npm run test:unit src/sessions
```

## Phase 4: Update Frontend to Consume ThreadEvent

### Step 4.1: Alias SessionEvent to ThreadEvent
**File:** `packages/web/types/web-sse.ts`

```typescript
// REPLACE entire SessionEvent definition with:
import type { ThreadEvent } from '@/../../src/threads/types';

export type SessionEvent = ThreadEvent;

// DELETE all the duplicate event type definitions
// DELETE UI_EVENT_TYPES constant (now in ThreadEvent)
```

### Step 4.2: Fix Token Usage Hook
**File:** `packages/web/hooks/useAgentTokenUsage.ts`

```typescript
// FIND:
if (event.type === 'AGENT_MESSAGE' && event.data?.data?.tokenUsage) {
  const tokenUsageData = event.data.data.tokenUsage;

// REPLACE with:
if (event.type === 'AGENT_MESSAGE' && event.data?.tokenUsage) {
  const tokenUsageData = event.data.tokenUsage; // Direct access!
```

### Step 4.3: Update useEventStream Hook
**File:** `packages/web/hooks/useEventStream.ts`

```typescript
// The event is now ThreadEvent, update type imports:
import type { ThreadEvent } from '@/../../src/threads/types';

// Update callback signatures:
export interface UseEventStreamOptions {
  onEvent?: (event: ThreadEvent) => void;
  onAgentMessage?: (event: ThreadEvent) => void;
  onToolCall?: (event: ThreadEvent) => void;
  // etc...
}
```

### Step 4.4: Test Frontend Hooks
```bash
cd packages/web
npm run test:unit
```

## Phase 5: Delete Timeline Converter

### Step 5.1: Create Direct Timeline Renderer
**File:** `packages/web/components/timeline-direct.tsx` (NEW)

```typescript
import type { ThreadEvent } from '@/../../src/threads/types';

export function TimelineDirect({ events }: { events: ThreadEvent[] }) {
  // Filter out events we don't show in timeline
  const visibleEvents = events.filter(e => 
    !e.transient || e.type === 'AGENT_STREAMING'
  );
  
  return (
    <div className="timeline">
      {visibleEvents.map(event => (
        <TimelineEventRenderer key={event.id} event={event} />
      ))}
    </div>
  );
}

function TimelineEventRenderer({ event }: { event: ThreadEvent }) {
  switch (event.type) {
    case 'USER_MESSAGE':
      return (
        <div className="timeline-entry user">
          <div className="content">{event.data}</div>
        </div>
      );
      
    case 'AGENT_MESSAGE':
      return (
        <div className="timeline-entry agent">
          <div className="content">{event.data.content}</div>
          {event.data.tokenUsage && (
            <div className="tokens">
              Tokens: {event.data.tokenUsage.total}
            </div>
          )}
        </div>
      );
      
    case 'TOOL_CALL':
      return (
        <div className="timeline-entry tool">
          <div className="tool-name">{event.data.toolName}</div>
          <pre>{JSON.stringify(event.data.input, null, 2)}</pre>
        </div>
      );
      
    case 'TOOL_RESULT':
      return (
        <div className="timeline-entry tool-result">
          <pre>{event.data.output}</pre>
        </div>
      );
      
    case 'AGENT_STREAMING':
      return (
        <div className="timeline-entry streaming">
          <div className="content">{event.data.content}</div>
        </div>
      );
      
    default:
      return null;
  }
}
```

### Step 5.2: Replace Timeline Component Usage
**File:** `packages/web/app/sessions/[sessionId]/components/session-view.tsx` (or similar)

```typescript
// FIND:
import { Timeline } from '@/components/timeline';
import { convertSessionEventsToTimeline } from '@/lib/timeline-converter';

const timelineEntries = convertSessionEventsToTimeline(events, context);
<Timeline entries={timelineEntries} />

// REPLACE with:
import { TimelineDirect } from '@/components/timeline-direct';

<TimelineDirect events={events} />
```

### Step 5.3: Delete Old Timeline Files
```bash
rm packages/web/lib/timeline-converter.ts
rm packages/web/lib/timeline-converter.test.ts
rm packages/web/types/web-events.ts  # TimelineEntry type
```

### Step 5.4: Test Timeline Rendering
```bash
cd packages/web
npm run dev
# Manually test that timeline shows events correctly
```

## Phase 6: Clean Up StreamEvent

### Step 6.1: Remove StreamEvent Usage
**File:** `src/sessions/session.ts`

```typescript
// Remove all imports of StreamEvent
// Remove all create*Event helper functions
// Ensure all events use ThreadEvent
```

### Step 6.2: Delete StreamEvent Files
```bash
rm -rf src/stream-events/
```

### Step 6.3: Update Imports
```bash
# Find all references to stream-events
grep -r "stream-events" src/ packages/

# Update each file to remove StreamEvent imports
```

### Step 6.4: Remove Adapter
```bash
rm src/events/stream-adapter.ts
rm src/events/stream-adapter.test.ts
```

## Phase 7: Final Validation

### Step 7.1: Run All Tests
```bash
npm run test:run
cd packages/web && npm run test:run
cd ../.. && npm run test:e2e
```

### Step 7.2: Manual Testing Checklist
- [ ] User can send messages
- [ ] Agent responses appear
- [ ] Token usage updates correctly
- [ ] Tool calls show in timeline
- [ ] Tool results display
- [ ] Streaming works
- [ ] Tool approvals work
- [ ] No console errors
- [ ] No data.data references in code

### Step 7.3: Code Cleanup
```bash
# Search for any remaining data.data patterns
grep -r "data\.data" src/ packages/

# Search for any remaining StreamEvent references
grep -r "StreamEvent" src/ packages/

# Search for timeline-converter references
grep -r "timeline-converter" src/ packages/
```

### Step 7.4: Update Documentation
**File:** `docs/design/event-architecture.md`

Document the new simplified architecture.

## Rollback Points

Each phase is independently revertible:

1. **Phase 1**: Just type changes, no runtime impact
2. **Phase 2**: Adapter can be removed
3. **Phase 3**: Can revert session-service changes
4. **Phase 4**: Frontend can go back to old types
5. **Phase 5**: Can restore timeline-converter
6. **Phase 6**: Can restore StreamEvent if needed

## Success Criteria

- ✅ No more `data.data.tokenUsage` - direct access works
- ✅ StreamEvent deleted (~200 lines)
- ✅ timeline-converter.ts deleted (344 lines)  
- ✅ Single event type (ThreadEvent) used everywhere
- ✅ All tests passing
- ✅ Manual testing confirms functionality

## Estimated Timeline

- Phase 1: 2 hours (type changes)
- Phase 2: 1 hour (adapter)
- Phase 3: 2 hours (session service)
- Phase 4: 2 hours (frontend)
- Phase 5: 3 hours (timeline replacement)
- Phase 6: 1 hour (cleanup)
- Phase 7: 2 hours (validation)

**Total: ~13 hours (2 days)**