# Event Architecture Design

## Overview

Lace uses a hierarchical event-driven architecture that enables real-time updates across the web interface while maintaining clean separation between the core system and web-specific concerns. This document defines the complete event architecture, identifies current gaps, and establishes patterns for future development.

## Core Principles

1. **Single Unified Stream**: All events flow through one EventStreamManager instance to avoid connection pool exhaustion
2. **Hierarchical Scoping**: Events are scoped from system → project → session → thread → task levels
3. **Client-Side Filtering**: Frontend subscribes to specific scopes and filters events locally
4. **Bridge Pattern**: SessionService acts as bridge between core EventEmitter events and web streaming
5. **Type Safety**: All events use discriminated unions with proper TypeScript typing

## Event Hierarchy & Scopes

```
System Level (global)
├── Project Level (projectId)
│   ├── Session Level (sessionId) 
│   │   ├── Agent/Thread Level (threadId)
│   │   │   ├── Tool Level (tool calls, results, approvals)
│   │   │   └── Message Level (user/agent messages, tokens)
│   │   └── Task Level (sessionId + taskId)
│   │       ├── Task Operations (create, update, delete, notes)
│   │       └── Task Assignment (agent spawning)
│   └── Project Operations (settings, configuration)
└── System Operations (health, diagnostics, global state)
```

## Event Types & Sources

### Current Event Sources

| Source | Events Emitted | Current Status | Event Type Used |
|--------|---------------|----------------|-----------------|
| **TaskManager** | `task:created`, `task:updated`, `task:deleted`, `task:note_added`, `agent:spawned` | ❌ NOT forwarded | Should be `task` |
| **Agent** | `agent_response_complete`, `agent_token`, `tool_call_start`, `tool_call_complete`, `state_change`, `error`, `conversation_complete`, `thread_event_added` | ✅ Forwarded | Currently `session` |
| **ThreadManager** | `TOOL_APPROVAL_REQUEST`, `TOOL_APPROVAL_RESPONSE` | ✅ Via Agent forwarding | Currently `session` |
| **Session** | Session lifecycle events | ❌ NOT implemented | Should be `session` |
| **Project** | Project operations | ❌ NOT implemented | Should be `project` |
| **System** | Health, diagnostics | ❌ NOT implemented | Should be `system` |

### Event Type Classification

```typescript
type StreamEventType = 
  | 'system'    // System-wide events (health, config changes)
  | 'project'   // Project-scoped events (settings, members)
  | 'session'   // Session-scoped events (lifecycle, agents, messages)
  | 'task'      // Task-scoped events (CRUD, assignments, notes)
  | 'tool'      // Tool-scoped events (calls, results, approvals)
```

## Current Architecture

### EventStreamManager (Web Layer)
```typescript
interface StreamEvent {
  id: string;
  timestamp: Date;
  eventType: 'system' | 'project' | 'session' | 'task' | 'tool';
  scope: {
    projectId?: string;
    sessionId?: string; 
    threadId?: string;
    taskId?: string;
  };
  data: SystemEvent | ProjectEvent | SessionEvent | TaskEvent | ToolEvent;
}
```

### Current Bridge: SessionService
- ✅ Forwards Agent events to EventStreamManager
- ❌ Does NOT forward TaskManager events 
- ❌ Manual wiring is incomplete and inconsistent
- ❌ Uses wrong eventType ('session' for everything)

### Frontend Subscription Model
```typescript
interface EventSubscription {
  projects?: string[];      // Filter by project IDs
  sessions?: string[];      // Filter by session IDs  
  threads?: string[];       // Filter by thread IDs
  eventTypes?: string[];    // Filter by event types
}
```

## Identified Gaps & Inconsistencies

### 🚨 Critical Issues

1. **TaskManager Events Missing**: Task creation/updates don't reach frontend
   - TaskManager emits events locally but SessionService doesn't forward them
   - Breaks real-time task list updates in web UI

2. **Wrong Event Types**: Everything broadcasts as `eventType: 'session'`
   - Task events should use `eventType: 'task'`
   - Tool events should use `eventType: 'tool'`
   - Makes client-side filtering brittle

3. **Incomplete Scope Information**: 
   - Missing projectId in many events
   - taskId not included in task events
   - Prevents proper hierarchical filtering

### 🔧 Architecture Debt

4. **Manual Event Wiring**: SessionService manually wires each Agent event
   - Error-prone and incomplete
   - Hard to maintain as events are added
   - Need systematic approach

5. **Missing Event Sources**:
   - No Session lifecycle events (created, destroyed, config changed)
   - No Project-level events (settings, members)
   - No System-level events (health, diagnostics)

6. **Inconsistent Event Patterns**:
   - Some events use ThreadEvent format, others use custom formats
   - Mixed timestamp formats (Date vs string)
   - No standard metadata patterns

## Proposed Complete Architecture

### 1. Systematic Event Forwarding

Replace manual wiring with systematic event forwarding:

```typescript
class SessionService {
  private setupEventForwarding(session: Session, sessionId: ThreadId): void {
    // Forward TaskManager events
    this.setupTaskManagerForwarding(session.getTaskManager(), sessionId);
    
    // Forward Agent events for all agents
    session.getAgents().forEach(agentInfo => {
      const agent = session.getAgent(agentInfo.threadId);
      if (agent) {
        this.setupAgentEventForwarding(agent, sessionId);
      }
    });
    
    // Forward Session lifecycle events
    this.setupSessionEventForwarding(session, sessionId);
  }
}
```

### 2. Correct Event Type Usage

```typescript
// TaskManager events → eventType: 'task'
this.broadcast({
  eventType: 'task',
  scope: { projectId, sessionId, taskId },
  data: taskEvent
});

// Agent events → eventType: 'session' 
this.broadcast({
  eventType: 'session', 
  scope: { projectId, sessionId, threadId },
  data: sessionEvent
});

// Tool events → eventType: 'tool'
this.broadcast({
  eventType: 'tool',
  scope: { projectId, sessionId, threadId, toolCallId },
  data: toolEvent
});
```

### 3. Complete Scope Information

All events must include complete hierarchical scope:

```typescript
interface EventScope {
  projectId?: string;    // Always include when available
  sessionId?: string;    // Session-scoped and below
  threadId?: string;     // Thread-scoped and below  
  taskId?: string;       // Task-scoped events only
  toolCallId?: string;   // Tool-scoped events only
}
```

### 4. Missing Event Sources

#### Session Lifecycle Events
```typescript
// When session created/destroyed/updated
const sessionEvent: SessionEvent = {
  type: 'SESSION_CREATED' | 'SESSION_DESTROYED' | 'SESSION_UPDATED',
  sessionId,
  timestamp: new Date(),
  data: { /* session metadata */ }
};
```

#### Project Events  
```typescript
// When project settings change, members added, etc.
const projectEvent: ProjectEvent = {
  type: 'PROJECT_UPDATED' | 'PROJECT_MEMBER_ADDED',
  projectId,
  timestamp: new Date(), 
  data: { /* project changes */ }
};
```

#### System Events
```typescript
// Health checks, global config changes
const systemEvent: SystemEvent = {
  type: 'SYSTEM_HEALTH' | 'CONFIG_UPDATED',
  timestamp: new Date(),
  data: { /* system info */ }
};
```

### 5. Unified Event Metadata

Standard metadata for all events:

```typescript
interface BaseEvent {
  id: string;           // Unique event ID
  timestamp: Date;      // Always Date object, not string
  actor?: string;       // Who triggered the event
  source: string;       // Which component emitted it
  version: string;      // Event schema version
}
```

## Frontend Subscription Patterns

### Current Patterns
```typescript
// useTaskStream - subscribes to task events for specific session
useTaskStream({ projectId, sessionId, onTaskCreated, ... });

// useSessionEvents - subscribes to session events for specific thread
useSessionEvents(sessionId, agentId);
```

### Proposed Enhanced Patterns
```typescript
// Hierarchical subscriptions
useEventStream({
  subscription: {
    projects: ['project-1'],           // All events in project
    sessions: ['session-1'],           // All events in session  
    eventTypes: ['task', 'session'],   // Only these event types
  }
});

// Specific event type subscriptions  
useTaskEvents({ projectId, sessionId });      // Only task events
useSessionEvents({ sessionId, threadId });    // Only session events
useProjectEvents({ projectId });              // Only project events
useSystemEvents();                            // Only system events
```

## Implementation Plan

### Phase 1: Fix Critical Issues ⚡
1. Add TaskManager event forwarding to SessionService
2. Use correct eventType for task events ('task' not 'session')  
3. Include complete scope information in all events
4. Test task creation updates reach frontend

### Phase 2: Systematic Architecture 🏗️
1. Replace manual Agent event wiring with systematic approach
2. Add Session lifecycle event forwarding
3. Implement Project-level event system
4. Add System-level event infrastructure

### Phase 3: Enhanced Patterns 🚀  
1. Unified event metadata across all sources
2. Enhanced frontend subscription patterns
3. Event versioning and migration system
4. Performance monitoring and diagnostics

## Testing Strategy

### Event Flow Testing
- Unit tests: Each event source emits correctly
- Integration tests: SessionService forwards all event types
- E2E tests: Frontend receives events in real-time

### Subscription Testing  
- Client-side filtering works correctly
- Hierarchical scoping is respected
- No event loss or duplication

### Performance Testing
- Single connection handles all event types
- Client-side filtering is efficient
- No memory leaks in long-running connections

## Future Considerations

### Event Persistence
- Should events be persisted for replay?
- Event sourcing for audit trails?
- Event-driven state reconstruction?

### Multi-Tenant Support
- How do events scope across tenants?
- Permission-based event filtering?
- Cross-tenant event isolation?

### Scalability  
- Event batching for high-frequency events?
- WebSocket scaling across processes?
- Event stream partitioning?

---

## Current Status: DRAFT

This document identifies the complete event architecture and current gaps. Next steps:
1. Review and validate this design
2. Implement Phase 1 fixes (TaskManager forwarding)
3. Plan systematic architecture improvements
4. Update implementation to match this design

**Key Decision**: Maintain current bridge pattern (SessionService) but make it complete and systematic rather than redesigning from scratch.