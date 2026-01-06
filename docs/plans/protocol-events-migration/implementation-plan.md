# Protocol Events Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate web package from LaceEvent to protocol events as the primary internal event system.

**Architecture:** Web package will consume protocol event types directly from `@lace/ent-protocol`. LaceEvent remains in agent package only. Translation layer is removed, replaced by direct protocol event forwarding. Event processing hooks and timeline components updated to work with protocol event structure.

**Tech Stack:** TypeScript, Zod schemas, React hooks, React Router v7, SSE event streaming

**Estimated Total Time:** 49-70 hours across 9 phases

---

## Phase 1: Protocol Event Type Definitions (2-3 hours)

### Task 1.1: Create Protocol Event Type Wrappers

**Files:**
- Create: `/Users/jesse/Documents/GitHub/lace/packages/web/types/protocol-events.ts`

**Step 1: Write the failing test**

Create test file first:

```typescript
// packages/web/types/__tests__/protocol-events.test.ts
import { describe, it, expect } from 'vitest';
import type {
  SessionUpdate,
  ProtocolEvent,
  TextDeltaUpdate,
  ToolUseUpdate,
  PermissionRequestEvent
} from '../protocol-events';

describe('Protocol Event Types', () => {
  it('should extract TextDeltaUpdate type correctly', () => {
    const update: TextDeltaUpdate = {
      sessionId: 'sess_123',
      streamSeq: 1,
      turnId: 'turn_1',
      turnSeq: 0,
      type: 'text_delta',
      text: 'Hello',
    };

    expect(update.type).toBe('text_delta');
    expect(update.text).toBe('Hello');
  });

  it('should create ProtocolEvent wrapper', () => {
    const protocolEvent: ProtocolEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    expect(protocolEvent.id).toBe('evt_123');
    expect(protocolEvent.update.type).toBe('text_delta');
  });

  it('should create PermissionRequestEvent wrapper', () => {
    const permEvent: PermissionRequestEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      request: {
        sessionId: 'sess_123',
        turnId: 'turn_1',
        turnSeq: 0,
        toolCallId: 'call_1',
        tool: 'bash',
        resource: 'rm -rf /',
        options: [
          { optionId: 'allow', label: 'Allow' },
          { optionId: 'deny', label: 'Deny' },
        ],
        requestedAt: new Date().toISOString(),
      },
      workspaceSessionId: 'ws_123',
    };

    expect(permEvent.request.tool).toBe('bash');
    expect(permEvent.request.options).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/types/__tests__/protocol-events.test.ts --run
```

Expected: FAIL - "Cannot find module '../protocol-events'"

**Step 3: Implement protocol event types**

```typescript
// packages/web/types/protocol-events.ts
import type { z } from 'zod';
import {
  SessionUpdateNotificationSchema,
  SessionRequestPermissionRequestSchema,
} from '@lace/ent-protocol';

/**
 * Protocol event types extracted from ent-protocol schemas.
 * These are the wire-format events sent by the supervisor.
 */

// Extract base session update type
export type SessionUpdate = z.infer<typeof SessionUpdateNotificationSchema>['params'];

// Extract permission request type
export type PermissionRequest = z.infer<typeof SessionRequestPermissionRequestSchema>['params'];

// Extract individual update types using discriminated union
export type TextDeltaUpdate = Extract<SessionUpdate, { type: 'text_delta' }>;
export type ThinkingUpdate = Extract<SessionUpdate, { type: 'thinking' }>;
export type UsageUpdate = Extract<SessionUpdate, { type: 'usage' }>;
export type ToolUseUpdate = Extract<SessionUpdate, { type: 'tool_use' }>;
export type TurnStartUpdate = Extract<SessionUpdate, { type: 'turn_start' }>;
export type TurnEndUpdate = Extract<SessionUpdate, { type: 'turn_end' }>;
export type ErrorUpdate = Extract<SessionUpdate, { type: 'error' }>;
export type SessionInfoUpdate = Extract<SessionUpdate, { type: 'session_info' }>;
export type ContextWindowUpdate = Extract<SessionUpdate, { type: 'context_window' }>;
export type CompactionStartUpdate = Extract<SessionUpdate, { type: 'compaction_start' }>;
export type CompactionCompleteUpdate = Extract<SessionUpdate, { type: 'compaction_complete' }>;
export type McpConfigChangedUpdate = Extract<SessionUpdate, { type: 'mcp_config_changed' }>;
export type McpServerStatusUpdate = Extract<SessionUpdate, { type: 'mcp_server_status' }>;
export type ModeChangeUpdate = Extract<SessionUpdate, { type: 'mode_change' }>;
export type ContextInjectedUpdate = Extract<SessionUpdate, { type: 'context_injected' }>;
export type PlanUpdate = Extract<SessionUpdate, { type: 'plan' }>;
export type JobStartedUpdate = Extract<SessionUpdate, { type: 'job_started' }>;
export type JobFinishedUpdate = Extract<SessionUpdate, { type: 'job_finished' }>;
export type JobUpdateUpdate = Extract<SessionUpdate, { type: 'job_update' }>;

/**
 * Web-specific wrapper for protocol events.
 * Adds metadata and context needed for web UI.
 */
export interface ProtocolEvent {
  // Event metadata
  id: string;
  timestamp: Date;

  // Protocol update data
  update: SessionUpdate;

  // Context from supervisor
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId: string; // from update.sessionId
}

/**
 * Web-specific wrapper for permission request events.
 */
export interface PermissionRequestEvent {
  id: string;
  timestamp: Date;
  request: PermissionRequest;
  workspaceSessionId: string;
  projectId?: string;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/types/__tests__/protocol-events.test.ts --run
```

Expected: PASS - All type assertions compile and tests pass

**Step 5: Commit**

```bash
git add packages/web/types/protocol-events.ts packages/web/types/__tests__/protocol-events.test.ts
git commit -m "feat(web): add protocol event type definitions

- Extract TypeScript types from ent-protocol Zod schemas
- Create ProtocolEvent and PermissionRequestEvent wrappers
- Add discriminated union types for all session update types
- Include workspace context in event wrappers"
```

---

### Task 1.2: Create Web-Internal Event Types

**Files:**
- Create: `/Users/jesse/Documents/GitHub/lace/packages/web/types/web-events.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/types/__tests__/web-events.test.ts
import { describe, it, expect } from 'vitest';
import type {
  WebEvent,
  UserMessageSentEvent,
  AgentStateChangeEvent,
  AgentSpawnedEvent
} from '../web-events';

describe('Web Internal Event Types', () => {
  it('should create UserMessageSentEvent', () => {
    const event: UserMessageSentEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      type: 'USER_MESSAGE_SENT',
      data: {
        content: 'Hello',
        agentSessionId: 'sess_123',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    expect(event.type).toBe('USER_MESSAGE_SENT');
    expect(event.data.content).toBe('Hello');
  });

  it('should create AgentStateChangeEvent', () => {
    const event: AgentStateChangeEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      type: 'AGENT_STATE_CHANGE',
      data: {
        agentSessionId: 'sess_123',
        previousState: 'idle',
        newState: 'thinking',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    expect(event.data.newState).toBe('thinking');
  });

  it('should discriminate web event types', () => {
    const event: WebEvent = {
      id: 'evt_789',
      timestamp: new Date(),
      type: 'AGENT_SPAWNED',
      data: {
        agentSessionId: 'sess_new',
        parentSessionId: 'sess_parent',
      },
      workspaceSessionId: 'ws_123',
    };

    if (event.type === 'AGENT_SPAWNED') {
      expect(event.data.parentSessionId).toBe('sess_parent');
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/types/__tests__/web-events.test.ts --run
```

Expected: FAIL - "Cannot find module '../web-events'"

**Step 3: Implement web event types**

```typescript
// packages/web/types/web-events.ts

/**
 * Web-internal events that are generated by the web UI,
 * not received from the supervisor protocol.
 */

export type WebEventType =
  | 'USER_MESSAGE_SENT'
  | 'AGENT_STATE_CHANGE'
  | 'AGENT_SPAWNED'
  | 'AGENT_SUMMARY_UPDATED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_DELETED'
  | 'SESSION_CREATED'
  | 'SESSION_UPDATED'
  | 'SESSION_DELETED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'SYSTEM_NOTIFICATION'
  | 'EVENT_UPDATED'
  | 'LOCAL_SYSTEM_MESSAGE'
  | 'TOOL_APPROVAL_RESPONSE';

/**
 * Base interface for web-internal events
 */
export interface WebEventBase {
  id: string;
  timestamp: Date;
  type: WebEventType;
  data: unknown;
  workspaceSessionId?: string;
  projectId?: string;
  agentSessionId?: string;
}

/**
 * User sent a message to an agent
 */
export interface UserMessageSentEvent extends WebEventBase {
  type: 'USER_MESSAGE_SENT';
  data: {
    content: string;
    agentSessionId: string;
  };
}

/**
 * Agent state changed (idle, thinking, streaming, etc.)
 */
export interface AgentStateChangeEvent extends WebEventBase {
  type: 'AGENT_STATE_CHANGE';
  data: {
    agentSessionId: string;
    previousState: string;
    newState: string;
  };
}

/**
 * New agent was spawned (delegate, parallel task, etc.)
 */
export interface AgentSpawnedEvent extends WebEventBase {
  type: 'AGENT_SPAWNED';
  data: {
    agentSessionId: string;
    parentSessionId?: string;
    taskId?: string;
  };
}

/**
 * Agent summary was updated (title, description)
 */
export interface AgentSummaryUpdatedEvent extends WebEventBase {
  type: 'AGENT_SUMMARY_UPDATED';
  data: {
    agentSessionId: string;
    summary: string;
  };
}

/**
 * Project lifecycle events
 */
export interface ProjectCreatedEvent extends WebEventBase {
  type: 'PROJECT_CREATED';
  data: {
    projectId: string;
    name: string;
  };
}

export interface ProjectUpdatedEvent extends WebEventBase {
  type: 'PROJECT_UPDATED';
  data: {
    projectId: string;
    changes: Record<string, unknown>;
  };
}

export interface ProjectDeletedEvent extends WebEventBase {
  type: 'PROJECT_DELETED';
  data: {
    projectId: string;
  };
}

/**
 * Session lifecycle events
 */
export interface SessionCreatedEvent extends WebEventBase {
  type: 'SESSION_CREATED';
  data: {
    sessionId: string;
    projectId: string;
  };
}

export interface SessionUpdatedEvent extends WebEventBase {
  type: 'SESSION_UPDATED';
  data: {
    sessionId: string;
    changes: Record<string, unknown>;
  };
}

export interface SessionDeletedEvent extends WebEventBase {
  type: 'SESSION_DELETED';
  data: {
    sessionId: string;
  };
}

/**
 * Task lifecycle events
 */
export interface TaskCreatedEvent extends WebEventBase {
  type: 'TASK_CREATED';
  data: {
    taskId: string;
    sessionId: string;
  };
}

export interface TaskUpdatedEvent extends WebEventBase {
  type: 'TASK_UPDATED';
  data: {
    taskId: string;
    changes: Record<string, unknown>;
  };
}

export interface TaskDeletedEvent extends WebEventBase {
  type: 'TASK_DELETED';
  data: {
    taskId: string;
  };
}

/**
 * System notification to display to user
 */
export interface SystemNotificationEvent extends WebEventBase {
  type: 'SYSTEM_NOTIFICATION';
  data: {
    message: string;
    level: 'info' | 'warning' | 'error' | 'success';
  };
}

/**
 * An event was updated (edited, metadata changed)
 */
export interface EventUpdatedEvent extends WebEventBase {
  type: 'EVENT_UPDATED';
  data: {
    eventId: string;
    changes: Record<string, unknown>;
  };
}

/**
 * Local system message (not from agent)
 */
export interface LocalSystemMessageEvent extends WebEventBase {
  type: 'LOCAL_SYSTEM_MESSAGE';
  data: {
    content: string;
    agentSessionId?: string;
  };
}

/**
 * User responded to tool approval request
 */
export interface ToolApprovalResponseEvent extends WebEventBase {
  type: 'TOOL_APPROVAL_RESPONSE';
  data: {
    requestId: string;
    approved: boolean;
    optionId: string;
  };
}

/**
 * Discriminated union of all web event types
 */
export type WebEvent =
  | UserMessageSentEvent
  | AgentStateChangeEvent
  | AgentSpawnedEvent
  | AgentSummaryUpdatedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectDeletedEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskDeletedEvent
  | SystemNotificationEvent
  | EventUpdatedEvent
  | LocalSystemMessageEvent
  | ToolApprovalResponseEvent;
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/types/__tests__/web-events.test.ts --run
```

Expected: PASS - All web event types compile correctly

**Step 5: Commit**

```bash
git add packages/web/types/web-events.ts packages/web/types/__tests__/web-events.test.ts
git commit -m "feat(web): add web-internal event types

- Define WebEvent discriminated union for UI-generated events
- Include user actions, agent lifecycle, project/session/task CRUD
- Add system notifications and tool approval responses
- Web events complement protocol events in hybrid system"
```

---

### Task 1.3: Create Unified App Event Types and Type Guards

**Files:**
- Create: `/Users/jesse/Documents/GitHub/lace/packages/web/types/app-events.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/types/__tests__/app-events.test.ts
import { describe, it, expect } from 'vitest';
import {
  isProtocolEvent,
  isPermissionRequestEvent,
  isWebEvent,
  type AppEvent,
} from '../app-events';
import type { ProtocolEvent, PermissionRequestEvent } from '../protocol-events';
import type { WebEvent } from '../web-events';

describe('App Event Type Guards', () => {
  it('should identify protocol events', () => {
    const event: ProtocolEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    expect(isProtocolEvent(event)).toBe(true);
    expect(isPermissionRequestEvent(event)).toBe(false);
    expect(isWebEvent(event)).toBe(false);
  });

  it('should identify permission request events', () => {
    const event: PermissionRequestEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      request: {
        sessionId: 'sess_123',
        turnId: 'turn_1',
        turnSeq: 0,
        toolCallId: 'call_1',
        tool: 'bash',
        resource: 'test',
        options: [],
        requestedAt: new Date().toISOString(),
      },
      workspaceSessionId: 'ws_123',
    };

    expect(isProtocolEvent(event)).toBe(false);
    expect(isPermissionRequestEvent(event)).toBe(true);
    expect(isWebEvent(event)).toBe(false);
  });

  it('should identify web events', () => {
    const event: WebEvent = {
      id: 'evt_789',
      timestamp: new Date(),
      type: 'USER_MESSAGE_SENT',
      data: {
        content: 'test',
        agentSessionId: 'sess_123',
      },
      workspaceSessionId: 'ws_123',
    };

    expect(isProtocolEvent(event)).toBe(false);
    expect(isPermissionRequestEvent(event)).toBe(false);
    expect(isWebEvent(event)).toBe(true);
  });

  it('should narrow types in conditional blocks', () => {
    const protocolEvent: AppEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    if (isProtocolEvent(protocolEvent)) {
      // TypeScript should narrow to ProtocolEvent
      expect(protocolEvent.update.type).toBe('text_delta');
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/types/__tests__/app-events.test.ts --run
```

Expected: FAIL - "Cannot find module '../app-events'"

**Step 3: Implement unified event types and type guards**

```typescript
// packages/web/types/app-events.ts
import type { ProtocolEvent, PermissionRequestEvent } from './protocol-events';
import type { WebEvent } from './web-events';

/**
 * Union type for all events that the web application handles.
 * Combines protocol events from supervisor with web-internal events.
 */
export type AppEvent = ProtocolEvent | PermissionRequestEvent | WebEvent;

/**
 * Type guard to check if an event is a protocol event
 */
export function isProtocolEvent(event: AppEvent): event is ProtocolEvent {
  return 'update' in event && event.update !== undefined;
}

/**
 * Type guard to check if an event is a permission request event
 */
export function isPermissionRequestEvent(event: AppEvent): event is PermissionRequestEvent {
  return 'request' in event && event.request !== undefined;
}

/**
 * Type guard to check if an event is a web-internal event
 */
export function isWebEvent(event: AppEvent): event is WebEvent {
  return 'type' in event && typeof event.type === 'string' && !('update' in event) && !('request' in event);
}

/**
 * Extract the event type for filtering and routing
 */
export function getEventType(event: AppEvent): string {
  if (isProtocolEvent(event)) {
    return `protocol:${event.update.type}`;
  }
  if (isPermissionRequestEvent(event)) {
    return 'protocol:permission_request';
  }
  if (isWebEvent(event)) {
    return `web:${event.type}`;
  }
  return 'unknown';
}

/**
 * Get the agent session ID from any event type
 */
export function getAgentSessionId(event: AppEvent): string | undefined {
  if (isProtocolEvent(event)) {
    return event.agentSessionId;
  }
  if (isPermissionRequestEvent(event)) {
    return event.request.sessionId;
  }
  if (isWebEvent(event)) {
    return event.agentSessionId;
  }
  return undefined;
}

/**
 * Get the workspace session ID from any event type
 */
export function getWorkspaceSessionId(event: AppEvent): string | undefined {
  if (isProtocolEvent(event) || isPermissionRequestEvent(event) || isWebEvent(event)) {
    return event.workspaceSessionId;
  }
  return undefined;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/types/__tests__/app-events.test.ts --run
```

Expected: PASS - Type guards work correctly and narrow types

**Step 5: Commit**

```bash
git add packages/web/types/app-events.ts packages/web/types/__tests__/app-events.test.ts
git commit -m "feat(web): add unified app event types and type guards

- Create AppEvent union type for all web package events
- Add type guards for protocol, permission, and web events
- Add helper functions to extract event type and session IDs
- Enable type-safe event discrimination in UI code"
```

---

## Phase 2: Update Translation Layer (4-6 hours)

### Task 2.1: Modify Supervisor Service to Emit Protocol Events

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/lace/packages/web/lib/server/supervisor-service.ts`
- Test: `/Users/jesse/Documents/GitHub/lace/packages/web/lib/server/__tests__/supervisor-service.test.ts`

**Step 1: Write the failing test**

First, check what tests already exist:

```bash
cd /Users/jesse/Documents/GitHub/lace
cat packages/web/lib/server/__tests__/supervisor-service.test.ts 2>/dev/null || echo "No test file exists"
```

If no test exists, create one:

```typescript
// packages/web/lib/server/__tests__/supervisor-service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupervisorServerEvent } from '@lace/supervisor';
import type { ProtocolEvent, PermissionRequestEvent } from '@/types/protocol-events';
import type { AppEvent } from '@/types/app-events';

// Mock event stream manager
const mockBroadcast = vi.fn();
vi.mock('@/lib/event-stream-manager', () => ({
  EventStreamManager: {
    getInstance: () => ({
      broadcast: mockBroadcast,
    }),
  },
}));

describe('Supervisor Service - Protocol Event Forwarding', () => {
  beforeEach(() => {
    mockBroadcast.mockClear();
  });

  it('should forward text_delta update as ProtocolEvent', () => {
    const supervisorEvent: SupervisorServerEvent = {
      type: 'session_update',
      workspaceSessionId: 'ws_123',
      projectId: 'proj_1',
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        turnId: 'turn_1',
        turnSeq: 0,
        type: 'text_delta',
        text: 'Hello world',
      },
    };

    // Import and call bridge function
    const { bridgeEventToWeb } = require('../supervisor-service');
    bridgeEventToWeb(supervisorEvent);

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    const broadcasted = mockBroadcast.mock.calls[0][0] as ProtocolEvent;

    expect(broadcasted).toMatchObject({
      update: supervisorEvent.update,
      workspaceSessionId: 'ws_123',
      projectId: 'proj_1',
      agentSessionId: 'sess_123',
    });
    expect(broadcasted.id).toBeDefined();
    expect(broadcasted.timestamp).toBeInstanceOf(Date);
  });

  it('should forward permission_request as PermissionRequestEvent', () => {
    const supervisorEvent: SupervisorServerEvent = {
      type: 'permission_request',
      workspaceSessionId: 'ws_123',
      projectId: 'proj_1',
      request: {
        sessionId: 'sess_123',
        turnId: 'turn_1',
        turnSeq: 0,
        toolCallId: 'call_1',
        tool: 'bash',
        resource: 'rm -rf /',
        options: [
          { optionId: 'allow_once', label: 'Allow Once' },
          { optionId: 'deny', label: 'Deny' },
        ],
        requestedAt: new Date().toISOString(),
      },
    };

    const { bridgeEventToWeb } = require('../supervisor-service');
    bridgeEventToWeb(supervisorEvent);

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    const broadcasted = mockBroadcast.mock.calls[0][0] as PermissionRequestEvent;

    expect(broadcasted).toMatchObject({
      request: supervisorEvent.request,
      workspaceSessionId: 'ws_123',
      projectId: 'proj_1',
    });
    expect(broadcasted.id).toBeDefined();
    expect(broadcasted.timestamp).toBeInstanceOf(Date);
  });

  it('should forward all protocol event types', () => {
    const eventTypes = [
      'text_delta',
      'thinking',
      'usage',
      'tool_use',
      'turn_start',
      'turn_end',
      'error',
      'session_info',
    ];

    eventTypes.forEach(type => {
      mockBroadcast.mockClear();

      const supervisorEvent: SupervisorServerEvent = {
        type: 'session_update',
        workspaceSessionId: 'ws_123',
        update: {
          sessionId: 'sess_123',
          streamSeq: 1,
          type: type as any,
          // Add minimal required fields based on type
          ...(type === 'text_delta' && { text: 'test' }),
          ...(type === 'thinking' && { text: 'thinking...' }),
        },
      };

      const { bridgeEventToWeb } = require('../supervisor-service');
      bridgeEventToWeb(supervisorEvent);

      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      const broadcasted = mockBroadcast.mock.calls[0][0] as ProtocolEvent;
      expect(broadcasted.update.type).toBe(type);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/lib/server/__tests__/supervisor-service.test.ts --run
```

Expected: FAIL - Tests fail because supervisor-service still emits LaceEvent

**Step 3: Read current supervisor-service implementation**

```bash
cd /Users/jesse/Documents/GitHub/lace
head -100 packages/web/lib/server/supervisor-service.ts
```

Take note of the current `updateToLaceEvents()` function and `bridgeEventToWeb()` implementation.

**Step 4: Implement protocol event forwarding**

Update the supervisor service to forward protocol events directly:

```typescript
// packages/web/lib/server/supervisor-service.ts
// Replace updateToLaceEvents translation with direct forwarding

import type { SupervisorServerEvent } from '@lace/supervisor';
import type { ProtocolEvent, PermissionRequestEvent } from '@/types/protocol-events';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { randomUUID } from 'crypto';

/**
 * Bridge supervisor events to web event stream.
 * Forwards protocol events directly without translation.
 */
export function bridgeEventToWeb(event: SupervisorServerEvent): void {
  const manager = EventStreamManager.getInstance();

  if (event.type === 'session_update') {
    const protocolEvent: ProtocolEvent = {
      id: `evt_${randomUUID()}`,
      timestamp: new Date(),
      update: event.update,
      workspaceSessionId: event.workspaceSessionId,
      projectId: event.projectId,
      agentSessionId: event.update.sessionId,
    };

    manager.broadcast(protocolEvent);
  } else if (event.type === 'permission_request') {
    const permissionEvent: PermissionRequestEvent = {
      id: `evt_${randomUUID()}`,
      timestamp: new Date(),
      request: event.request,
      workspaceSessionId: event.workspaceSessionId,
      projectId: event.projectId,
    };

    manager.broadcast(permissionEvent);
  }
}

// Remove the old updateToLaceEvents() function entirely
```

**Step 5: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/lib/server/__tests__/supervisor-service.test.ts --run
```

Expected: PASS - Protocol events are forwarded correctly

**Step 6: Commit**

```bash
git add packages/web/lib/server/supervisor-service.ts packages/web/lib/server/__tests__/supervisor-service.test.ts
git commit -m "refactor(web): forward protocol events directly from supervisor

- Remove updateToLaceEvents() translation layer
- Forward session_update as ProtocolEvent wrapper
- Forward permission_request as PermissionRequestEvent wrapper
- Add event IDs and timestamps for web event tracking
- BREAKING: EventStreamManager must now accept AppEvent types"
```

---

## Phase 3: Update Event Stream Infrastructure (8-12 hours)

### Task 3.1: Update EventStreamManager to Handle AppEvent Types

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/lace/packages/web/lib/event-stream-manager.ts`
- Test: `/Users/jesse/Documents/GitHub/lace/packages/web/lib/__tests__/event-stream-manager.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/lib/__tests__/event-stream-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStreamManager } from '../event-stream-manager';
import type { ProtocolEvent } from '@/types/protocol-events';
import type { WebEvent } from '@/types/web-events';
import type { AppEvent } from '@/types/app-events';

describe('EventStreamManager - AppEvent Support', () => {
  let manager: EventStreamManager;

  beforeEach(() => {
    manager = EventStreamManager.getInstance();
  });

  afterEach(() => {
    manager.closeAll();
  });

  it('should broadcast protocol events to matching subscribers', (done) => {
    const protocolEvent: ProtocolEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    const connectionId = manager.createConnection('ws_123');

    manager.subscribe(connectionId, (event) => {
      expect(event).toEqual(protocolEvent);
      done();
    });

    manager.broadcast(protocolEvent);
  });

  it('should broadcast web events to subscribers', (done) => {
    const webEvent: WebEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      type: 'USER_MESSAGE_SENT',
      data: {
        content: 'Hello',
        agentSessionId: 'sess_123',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    const connectionId = manager.createConnection('ws_123');

    manager.subscribe(connectionId, (event) => {
      expect(event).toEqual(webEvent);
      done();
    });

    manager.broadcast(webEvent);
  });

  it('should filter events by agent session ID', () => {
    const receivedEvents: AppEvent[] = [];

    const event1: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'agent 123',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    const event2: ProtocolEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_456',
        streamSeq: 1,
        type: 'text_delta',
        text: 'agent 456',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_456',
    };

    const connectionId = manager.createConnection('ws_123', { agentSessionId: 'sess_123' });

    manager.subscribe(connectionId, (event) => {
      receivedEvents.push(event);
    });

    manager.broadcast(event1);
    manager.broadcast(event2);

    // Should only receive event1
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].id).toBe('evt_1');
  });

  it('should filter events by workspace session ID', () => {
    const receivedEvents: AppEvent[] = [];

    const event1: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'workspace 1',
      },
      workspaceSessionId: 'ws_1',
      agentSessionId: 'sess_123',
    };

    const event2: ProtocolEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_456',
        streamSeq: 1,
        type: 'text_delta',
        text: 'workspace 2',
      },
      workspaceSessionId: 'ws_2',
      agentSessionId: 'sess_456',
    };

    const connectionId = manager.createConnection('ws_1');

    manager.subscribe(connectionId, (event) => {
      receivedEvents.push(event);
    });

    manager.broadcast(event1);
    manager.broadcast(event2);

    // Should only receive event1
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].id).toBe('evt_1');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/lib/__tests__/event-stream-manager.test.ts --run
```

Expected: FAIL - EventStreamManager still expects LaceEvent

**Step 3: Read current EventStreamManager implementation**

```bash
cd /Users/jesse/Documents/GitHub/lace
cat packages/web/lib/event-stream-manager.ts
```

**Step 4: Update EventStreamManager for AppEvent types**

Modify the EventStreamManager to work with AppEvent:

```typescript
// packages/web/lib/event-stream-manager.ts
import type { AppEvent } from '@/types/app-events';
import {
  isProtocolEvent,
  isPermissionRequestEvent,
  isWebEvent,
  getAgentSessionId,
  getWorkspaceSessionId,
} from '@/types/app-events';

export interface ConnectionFilter {
  workspaceSessionId?: string;
  agentSessionId?: string;
  projectId?: string;
}

export interface Connection {
  id: string;
  filter: ConnectionFilter;
  callback: (event: AppEvent) => void;
  createdAt: Date;
}

export class EventStreamManager {
  private static instance: EventStreamManager;
  private connections: Map<string, Connection> = new Map();

  private constructor() {}

  public static getInstance(): EventStreamManager {
    if (!EventStreamManager.instance) {
      EventStreamManager.instance = new EventStreamManager();
    }
    return EventStreamManager.instance;
  }

  /**
   * Create a new event stream connection with optional filtering
   */
  public createConnection(
    workspaceSessionId: string,
    additionalFilter?: Omit<ConnectionFilter, 'workspaceSessionId'>
  ): string {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Connection is created but callback is set via subscribe()
    const connection: Connection = {
      id: connectionId,
      filter: {
        workspaceSessionId,
        ...additionalFilter,
      },
      callback: () => {}, // Set later via subscribe
      createdAt: new Date(),
    };

    this.connections.set(connectionId, connection);
    return connectionId;
  }

  /**
   * Subscribe to events for a connection
   */
  public subscribe(connectionId: string, callback: (event: AppEvent) => void): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    connection.callback = callback;
  }

  /**
   * Broadcast an event to all matching connections
   */
  public broadcast(event: AppEvent): void {
    for (const connection of this.connections.values()) {
      if (this.shouldSendToConnection(event, connection.filter)) {
        connection.callback(event);
      }
    }
  }

  /**
   * Determine if an event should be sent to a connection based on its filter
   */
  private shouldSendToConnection(event: AppEvent, filter: ConnectionFilter): boolean {
    // Workspace session must match
    const eventWorkspaceSessionId = getWorkspaceSessionId(event);
    if (filter.workspaceSessionId && eventWorkspaceSessionId !== filter.workspaceSessionId) {
      return false;
    }

    // Agent session must match if filter is set
    if (filter.agentSessionId) {
      const eventAgentSessionId = getAgentSessionId(event);
      if (!eventAgentSessionId || eventAgentSessionId !== filter.agentSessionId) {
        return false;
      }
    }

    // Project must match if filter is set
    if (filter.projectId) {
      if (isProtocolEvent(event) || isPermissionRequestEvent(event)) {
        if (event.projectId !== filter.projectId) {
          return false;
        }
      } else if (isWebEvent(event)) {
        if (event.projectId !== filter.projectId) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Close a specific connection
   */
  public closeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * Close all connections
   */
  public closeAll(): void {
    this.connections.clear();
  }

  /**
   * Get connection count for monitoring
   */
  public getConnectionCount(): number {
    return this.connections.size;
  }
}
```

**Step 5: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/lib/__tests__/event-stream-manager.test.ts --run
```

Expected: PASS - All event filtering and broadcasting works with AppEvent

**Step 6: Commit**

```bash
git add packages/web/lib/event-stream-manager.ts packages/web/lib/__tests__/event-stream-manager.test.ts
git commit -m "refactor(web): update EventStreamManager for AppEvent types

- Replace LaceEvent with AppEvent union type
- Use type guards for event discrimination
- Update filtering to work with protocol and web events
- Extract session IDs using helper functions
- Maintain backward compatible filtering behavior"
```

---

### Task 3.2: Update SSEStore for AppEvent Types

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/lace/packages/web/lib/sse-store.ts`
- Test: `/Users/jesse/Documents/GitHub/lace/packages/web/lib/__tests__/sse-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/lib/__tests__/sse-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SSEStore } from '../sse-store';
import type { ProtocolEvent } from '@/types/protocol-events';
import type { WebEvent } from '@/types/web-events';
import type { AppEvent } from '@/types/app-events';

describe('SSEStore - AppEvent Support', () => {
  let store: SSEStore;

  beforeEach(() => {
    store = new SSEStore();
  });

  it('should filter protocol events by type', () => {
    const receivedEvents: AppEvent[] = [];

    const textEvent: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'hello',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    const thinkingEvent: ProtocolEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 2,
        type: 'thinking',
        text: 'thinking...',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    store.subscribe(
      { protocolEventTypes: ['text_delta'] },
      (event) => receivedEvents.push(event)
    );

    store.emit(textEvent);
    store.emit(thinkingEvent);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].id).toBe('evt_1');
  });

  it('should filter web events by type', () => {
    const receivedEvents: AppEvent[] = [];

    const userMessageEvent: WebEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      type: 'USER_MESSAGE_SENT',
      data: { content: 'test', agentSessionId: 'sess_123' },
      workspaceSessionId: 'ws_123',
    };

    const stateChangeEvent: WebEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      type: 'AGENT_STATE_CHANGE',
      data: { agentSessionId: 'sess_123', previousState: 'idle', newState: 'thinking' },
      workspaceSessionId: 'ws_123',
    };

    store.subscribe(
      { webEventTypes: ['USER_MESSAGE_SENT'] },
      (event) => receivedEvents.push(event)
    );

    store.emit(userMessageEvent);
    store.emit(stateChangeEvent);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].id).toBe('evt_1');
  });

  it('should filter by agent session ID', () => {
    const receivedEvents: AppEvent[] = [];

    const event1: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'agent 123',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    const event2: ProtocolEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_456',
        streamSeq: 1,
        type: 'text_delta',
        text: 'agent 456',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_456',
    };

    store.subscribe(
      { agentSessionId: 'sess_123' },
      (event) => receivedEvents.push(event)
    );

    store.emit(event1);
    store.emit(event2);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].id).toBe('evt_1');
  });

  it('should allow unsubscribe', () => {
    const receivedEvents: AppEvent[] = [];

    const event: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    const unsubscribe = store.subscribe(
      {},
      (event) => receivedEvents.push(event)
    );

    store.emit(event);
    expect(receivedEvents).toHaveLength(1);

    unsubscribe();

    store.emit(event);
    expect(receivedEvents).toHaveLength(1); // Still 1, not 2
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/lib/__tests__/sse-store.test.ts --run
```

Expected: FAIL - SSEStore still uses LaceEvent types

**Step 3: Read current SSEStore implementation**

```bash
cd /Users/jesse/Documents/GitHub/lace
cat packages/web/lib/sse-store.ts
```

**Step 4: Update SSEStore for AppEvent types**

```typescript
// packages/web/lib/sse-store.ts
import type { AppEvent } from '@/types/app-events';
import {
  isProtocolEvent,
  isPermissionRequestEvent,
  isWebEvent,
  getAgentSessionId,
  getWorkspaceSessionId,
} from '@/types/app-events';

export interface EventFilter {
  // Filter by event types
  protocolEventTypes?: string[]; // e.g., ['text_delta', 'tool_use']
  webEventTypes?: string[]; // e.g., ['USER_MESSAGE_SENT']

  // Filter by context
  workspaceSessionId?: string;
  agentSessionId?: string;
  projectId?: string;
}

type EventCallback = (event: AppEvent) => void;

interface Subscription {
  id: string;
  filter: EventFilter;
  callback: EventCallback;
}

export class SSEStore {
  private subscriptions: Map<string, Subscription> = new Map();
  private nextId = 1;

  /**
   * Subscribe to events matching the filter
   * @returns Unsubscribe function
   */
  public subscribe(filter: EventFilter, callback: EventCallback): () => void {
    const id = `sub_${this.nextId++}`;

    this.subscriptions.set(id, {
      id,
      filter,
      callback,
    });

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(id);
    };
  }

  /**
   * Emit an event to all matching subscribers
   */
  public emit(event: AppEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (this.eventMatchesFilter(event, subscription.filter)) {
        subscription.callback(event);
      }
    }
  }

  /**
   * Check if an event matches a filter
   */
  private eventMatchesFilter(event: AppEvent, filter: EventFilter): boolean {
    // Filter by workspace session ID
    if (filter.workspaceSessionId) {
      const eventWorkspaceSessionId = getWorkspaceSessionId(event);
      if (eventWorkspaceSessionId !== filter.workspaceSessionId) {
        return false;
      }
    }

    // Filter by agent session ID
    if (filter.agentSessionId) {
      const eventAgentSessionId = getAgentSessionId(event);
      if (eventAgentSessionId !== filter.agentSessionId) {
        return false;
      }
    }

    // Filter by project ID
    if (filter.projectId) {
      if (isProtocolEvent(event) || isPermissionRequestEvent(event)) {
        if (event.projectId !== filter.projectId) {
          return false;
        }
      } else if (isWebEvent(event)) {
        if (event.projectId !== filter.projectId) {
          return false;
        }
      }
    }

    // Filter by protocol event types
    if (filter.protocolEventTypes && filter.protocolEventTypes.length > 0) {
      if (!isProtocolEvent(event)) {
        return false;
      }
      if (!filter.protocolEventTypes.includes(event.update.type)) {
        return false;
      }
    }

    // Filter by web event types
    if (filter.webEventTypes && filter.webEventTypes.length > 0) {
      if (!isWebEvent(event)) {
        return false;
      }
      if (!filter.webEventTypes.includes(event.type)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Clear all subscriptions
   */
  public clear(): void {
    this.subscriptions.clear();
  }

  /**
   * Get subscription count for debugging
   */
  public getSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}
```

**Step 5: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/lib/__tests__/sse-store.test.ts --run
```

Expected: PASS - Event filtering works with AppEvent types

**Step 6: Commit**

```bash
git add packages/web/lib/sse-store.ts packages/web/lib/__tests__/sse-store.test.ts
git commit -m "refactor(web): update SSEStore for AppEvent types

- Replace LaceEvent with AppEvent throughout
- Add separate filters for protocol and web event types
- Use type guards for event discrimination
- Maintain session and project ID filtering
- Add unsubscribe functionality for cleanup"
```

---

### Task 3.3: Update Stream Event Types

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/lace/packages/web/types/stream-events.ts`

**Step 1: Read current stream-events.ts**

```bash
cd /Users/jesse/Documents/GitHub/lace
cat packages/web/types/stream-events.ts
```

**Step 2: Update stream event types for AppEvent**

Replace LaceEvent references with AppEvent:

```typescript
// packages/web/types/stream-events.ts
import type { AppEvent } from './app-events';
import type { ProtocolEvent, PermissionRequestEvent } from './protocol-events';
import type { WebEvent } from './web-events';

/**
 * SSE message format sent to clients
 */
export interface SSEMessage {
  event: 'message' | 'error' | 'ping';
  data: AppEvent | { error: string } | { type: 'ping' };
}

/**
 * Event stream connection metadata
 */
export interface EventStreamConnection {
  id: string;
  workspaceSessionId: string;
  agentSessionId?: string;
  projectId?: string;
  connectedAt: Date;
  lastEventAt?: Date;
}

/**
 * Re-export event types for convenience
 */
export type { AppEvent, ProtocolEvent, PermissionRequestEvent, WebEvent };
```

**Step 3: Verify TypeScript compilation**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx tsc --noEmit --project packages/web/tsconfig.json
```

Expected: No errors related to stream-events.ts

**Step 4: Commit**

```bash
git add packages/web/types/stream-events.ts
git commit -m "refactor(web): update stream event types for AppEvent

- Replace LaceEvent with AppEvent in SSE message format
- Add re-exports for convenience
- Update event stream connection metadata
- Maintain backward compatible structure"
```

---

## Phase 4: Update Event Hooks (12-16 hours)

### Task 4.1: Update useEventStream Hook

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/lace/packages/web/hooks/useEventStream.ts`
- Test: `/Users/jesse/Documents/GitHub/lace/packages/web/hooks/__tests__/useEventStream.test.tsx`

**Step 1: Write the failing test**

```typescript
// packages/web/hooks/__tests__/useEventStream.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEventStream } from '../useEventStream';
import type { ProtocolEvent } from '@/types/protocol-events';
import type { WebEvent } from '@/types/web-events';

// Mock SSEStore
const mockSubscribe = vi.fn();
const mockEmit = vi.fn();

vi.mock('@/lib/sse-store', () => ({
  SSEStore: class {
    subscribe = mockSubscribe;
    emit = mockEmit;
  },
}));

describe('useEventStream - Protocol Event Support', () => {
  it('should handle text_delta events', async () => {
    const onTextDelta = vi.fn();

    const { result } = renderHook(() =>
      useEventStream({
        agentSessionId: 'sess_123',
        onTextDelta,
      })
    );

    // Get the callback that was passed to subscribe
    const subscribeCallback = mockSubscribe.mock.calls[0][1];

    const textEvent: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        type: 'text_delta',
        text: 'Hello world',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    // Simulate event received
    subscribeCallback(textEvent);

    await waitFor(() => {
      expect(onTextDelta).toHaveBeenCalledWith({
        text: 'Hello world',
        agentSessionId: 'sess_123',
        streamSeq: 1,
      });
    });
  });

  it('should handle tool_use events', async () => {
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    renderHook(() =>
      useEventStream({
        agentSessionId: 'sess_123',
        onToolCall,
        onToolResult,
      })
    );

    const subscribeCallback = mockSubscribe.mock.calls[0][1];

    // Tool call started
    const toolCallEvent: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 1,
        turnId: 'turn_1',
        turnSeq: 0,
        type: 'tool_use',
        toolCallId: 'call_1',
        name: 'bash',
        input: { command: 'ls' },
        status: 'pending',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    subscribeCallback(toolCallEvent);

    await waitFor(() => {
      expect(onToolCall).toHaveBeenCalledWith({
        toolCallId: 'call_1',
        name: 'bash',
        input: { command: 'ls' },
        status: 'pending',
      });
    });

    // Tool call completed
    const toolResultEvent: ProtocolEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      update: {
        sessionId: 'sess_123',
        streamSeq: 2,
        turnId: 'turn_1',
        turnSeq: 1,
        type: 'tool_use',
        toolCallId: 'call_1',
        name: 'bash',
        status: 'completed',
        result: {
          outcome: 'success',
          content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
          meta: {},
        },
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    subscribeCallback(toolResultEvent);

    await waitFor(() => {
      expect(onToolResult).toHaveBeenCalledWith({
        toolCallId: 'call_1',
        outcome: 'success',
        content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
      });
    });
  });

  it('should handle web events', async () => {
    const onUserMessage = vi.fn();

    renderHook(() =>
      useEventStream({
        agentSessionId: 'sess_123',
        onUserMessage,
      })
    );

    const subscribeCallback = mockSubscribe.mock.calls[0][1];

    const webEvent: WebEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      type: 'USER_MESSAGE_SENT',
      data: {
        content: 'Test message',
        agentSessionId: 'sess_123',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: 'sess_123',
    };

    subscribeCallback(webEvent);

    await waitFor(() => {
      expect(onUserMessage).toHaveBeenCalledWith({
        content: 'Test message',
        agentSessionId: 'sess_123',
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/hooks/__tests__/useEventStream.test.tsx --run
```

Expected: FAIL - useEventStream still expects LaceEvent

**Step 3: Read current useEventStream implementation**

```bash
cd /Users/jesse/Documents/GitHub/lace
cat packages/web/hooks/useEventStream.ts
```

**Step 4: Rewrite useEventStream for protocol events**

```typescript
// packages/web/hooks/useEventStream.ts
import { useEffect, useRef } from 'react';
import type { AppEvent } from '@/types/app-events';
import {
  isProtocolEvent,
  isPermissionRequestEvent,
  isWebEvent
} from '@/types/app-events';
import { SSEStore } from '@/lib/sse-store';

/**
 * Callbacks for different event types
 */
export interface EventHandlers {
  // Protocol events
  onTextDelta?: (data: { text: string; agentSessionId: string; streamSeq: number }) => void;
  onThinking?: (data: { text: string; agentSessionId: string }) => void;
  onUsage?: (data: { inputTokens: number; outputTokens: number }) => void;
  onToolCall?: (data: { toolCallId: string; name: string; input: unknown; status: string }) => void;
  onToolResult?: (data: { toolCallId: string; outcome: string; content: unknown[] }) => void;
  onTurnStart?: (data: { turnId: string; agentSessionId: string }) => void;
  onTurnEnd?: (data: { turnId: string; content: unknown[]; agentSessionId: string }) => void;
  onError?: (data: { code: string; message: string; phase?: string }) => void;

  // Permission requests
  onPermissionRequest?: (data: {
    requestId: string;
    toolCallId: string;
    tool: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
  }) => void;

  // Web events
  onUserMessage?: (data: { content: string; agentSessionId: string }) => void;
  onAgentStateChange?: (data: { agentSessionId: string; previousState: string; newState: string }) => void;
  onAgentSpawned?: (data: { agentSessionId: string; parentSessionId?: string }) => void;

  // Generic fallback
  onEvent?: (event: AppEvent) => void;
}

export interface UseEventStreamOptions extends EventHandlers {
  workspaceSessionId?: string;
  agentSessionId?: string;
  projectId?: string;
  enabled?: boolean;
}

/**
 * Hook to subscribe to event stream with type-safe handlers
 */
export function useEventStream(options: UseEventStreamOptions) {
  const {
    workspaceSessionId,
    agentSessionId,
    projectId,
    enabled = true,
    onTextDelta,
    onThinking,
    onUsage,
    onToolCall,
    onToolResult,
    onTurnStart,
    onTurnEnd,
    onError,
    onPermissionRequest,
    onUserMessage,
    onAgentStateChange,
    onAgentSpawned,
    onEvent,
  } = options;

  const handlersRef = useRef({
    onTextDelta,
    onThinking,
    onUsage,
    onToolCall,
    onToolResult,
    onTurnStart,
    onTurnEnd,
    onError,
    onPermissionRequest,
    onUserMessage,
    onAgentStateChange,
    onAgentSpawned,
    onEvent,
  });

  // Update handlers ref on every render (avoid stale closures)
  handlersRef.current = {
    onTextDelta,
    onThinking,
    onUsage,
    onToolCall,
    onToolResult,
    onTurnStart,
    onTurnEnd,
    onError,
    onPermissionRequest,
    onUserMessage,
    onAgentStateChange,
    onAgentSpawned,
    onEvent,
  };

  useEffect(() => {
    if (!enabled) return;

    const store = new SSEStore();

    const unsubscribe = store.subscribe(
      {
        workspaceSessionId,
        agentSessionId,
        projectId,
      },
      (event: AppEvent) => {
        // Route to appropriate handler based on event type
        if (isProtocolEvent(event)) {
          handleProtocolEvent(event, handlersRef.current);
        } else if (isPermissionRequestEvent(event)) {
          handlePermissionRequest(event, handlersRef.current);
        } else if (isWebEvent(event)) {
          handleWebEvent(event, handlersRef.current);
        }

        // Call generic handler if provided
        handlersRef.current.onEvent?.(event);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [workspaceSessionId, agentSessionId, projectId, enabled]);
}

/**
 * Route protocol events to specific handlers
 */
function handleProtocolEvent(
  event: ProtocolEvent,
  handlers: EventHandlers
): void {
  const { update, agentSessionId } = event;

  switch (update.type) {
    case 'text_delta':
      handlers.onTextDelta?.({
        text: update.text || '',
        agentSessionId,
        streamSeq: update.streamSeq,
      });
      break;

    case 'thinking':
      handlers.onThinking?.({
        text: update.text || '',
        agentSessionId,
      });
      break;

    case 'usage':
      handlers.onUsage?.({
        inputTokens: update.inputTokens || 0,
        outputTokens: update.outputTokens || 0,
      });
      break;

    case 'tool_use':
      if (update.status === 'pending' || update.status === 'running') {
        handlers.onToolCall?.({
          toolCallId: update.toolCallId!,
          name: update.name!,
          input: update.input,
          status: update.status,
        });
      } else if (update.status === 'completed' || update.status === 'failed') {
        handlers.onToolResult?.({
          toolCallId: update.toolCallId!,
          outcome: update.result?.outcome || 'error',
          content: update.result?.content || [],
        });
      }
      break;

    case 'turn_start':
      handlers.onTurnStart?.({
        turnId: update.turnId!,
        agentSessionId,
      });
      break;

    case 'turn_end':
      handlers.onTurnEnd?.({
        turnId: update.turnId!,
        content: update.content || [],
        agentSessionId,
      });
      break;

    case 'error':
      handlers.onError?.({
        code: update.code || 'UNKNOWN',
        message: update.message || 'Unknown error',
        phase: update.phase,
      });
      break;

    // Add other event types as needed
  }
}

/**
 * Handle permission request events
 */
function handlePermissionRequest(
  event: PermissionRequestEvent,
  handlers: EventHandlers
): void {
  const { request } = event;

  handlers.onPermissionRequest?.({
    requestId: event.id,
    toolCallId: request.toolCallId,
    tool: request.tool,
    resource: request.resource,
    options: request.options,
  });
}

/**
 * Route web events to specific handlers
 */
function handleWebEvent(event: WebEvent, handlers: EventHandlers): void {
  switch (event.type) {
    case 'USER_MESSAGE_SENT':
      handlers.onUserMessage?.({
        content: (event.data as any).content,
        agentSessionId: (event.data as any).agentSessionId,
      });
      break;

    case 'AGENT_STATE_CHANGE':
      handlers.onAgentStateChange?.({
        agentSessionId: (event.data as any).agentSessionId,
        previousState: (event.data as any).previousState,
        newState: (event.data as any).newState,
      });
      break;

    case 'AGENT_SPAWNED':
      handlers.onAgentSpawned?.({
        agentSessionId: (event.data as any).agentSessionId,
        parentSessionId: (event.data as any).parentSessionId,
      });
      break;

    // Add other web event types as needed
  }
}
```

**Step 5: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/hooks/__tests__/useEventStream.test.tsx --run
```

Expected: PASS - Event routing works correctly

**Step 6: Commit**

```bash
git add packages/web/hooks/useEventStream.ts packages/web/hooks/__tests__/useEventStream.test.tsx
git commit -m "refactor(web): rewrite useEventStream for protocol events

- Replace LaceEvent with AppEvent discrimination
- Add type-specific handlers for protocol events
- Route text_delta, tool_use, thinking, usage, turn_start/end
- Handle permission requests separately
- Support web-internal events
- Maintain callback ref to avoid stale closures"
```

---

### Task 4.2: Update useProcessedEvents Hook

This task handles the complex timeline event aggregation logic.

**Files:**
- Modify: `/Users/jesse/Documents/GitHub/lace/packages/web/hooks/useProcessedEvents.ts`
- Test: `/Users/jesse/Documents/GitHub/lace/packages/web/hooks/__tests__/useProcessedEvents.test.tsx`

**Step 1: Write the failing test**

```typescript
// packages/web/hooks/__tests__/useProcessedEvents.test.tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProcessedEvents } from '../useProcessedEvents';
import type { ProtocolEvent } from '@/types/protocol-events';
import type { AppEvent } from '@/types/app-events';

describe('useProcessedEvents - Protocol Event Processing', () => {
  it('should aggregate text_delta events into messages', () => {
    const events: AppEvent[] = [
      {
        id: 'evt_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 1,
          turnId: 'turn_1',
          turnSeq: 0,
          type: 'text_delta',
          text: 'Hello ',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
      {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:01Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 2,
          turnId: 'turn_1',
          turnSeq: 1,
          type: 'text_delta',
          text: 'world',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
    ];

    const { result } = renderHook(() => useProcessedEvents(events));

    expect(result.current.processed).toHaveLength(1);
    expect(result.current.processed[0]).toMatchObject({
      type: 'message',
      turnId: 'turn_1',
      content: 'Hello world',
      isStreaming: false,
    });
  });

  it('should pair tool_use events into tool entries', () => {
    const events: AppEvent[] = [
      {
        id: 'evt_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 1,
          turnId: 'turn_1',
          turnSeq: 0,
          type: 'tool_use',
          toolCallId: 'call_1',
          name: 'bash',
          input: { command: 'ls' },
          status: 'pending',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
      {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:02Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 2,
          turnId: 'turn_1',
          turnSeq: 1,
          type: 'tool_use',
          toolCallId: 'call_1',
          name: 'bash',
          status: 'completed',
          result: {
            outcome: 'success',
            content: [{ type: 'text', text: 'file1.txt' }],
            meta: {},
          },
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
    ];

    const { result } = renderHook(() => useProcessedEvents(events));

    expect(result.current.processed).toHaveLength(1);
    expect(result.current.processed[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'call_1',
      name: 'bash',
      input: { command: 'ls' },
      status: 'completed',
      outcome: 'success',
    });
  });

  it('should create separate entries for different turns', () => {
    const events: AppEvent[] = [
      {
        id: 'evt_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 1,
          turnId: 'turn_1',
          type: 'text_delta',
          text: 'Turn 1',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
      {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 2,
          turnId: 'turn_2',
          type: 'text_delta',
          text: 'Turn 2',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
    ];

    const { result } = renderHook(() => useProcessedEvents(events));

    expect(result.current.processed).toHaveLength(2);
    expect(result.current.processed[0].turnId).toBe('turn_1');
    expect(result.current.processed[1].turnId).toBe('turn_2');
  });

  it('should handle thinking events', () => {
    const events: AppEvent[] = [
      {
        id: 'evt_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 1,
          turnId: 'turn_1',
          type: 'thinking',
          text: 'Let me think...',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
    ];

    const { result } = renderHook(() => useProcessedEvents(events));

    expect(result.current.processed).toHaveLength(1);
    expect(result.current.processed[0]).toMatchObject({
      type: 'thinking',
      content: 'Let me think...',
    });
  });

  it('should handle error events', () => {
    const events: AppEvent[] = [
      {
        id: 'evt_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: 'sess_123',
          streamSeq: 1,
          type: 'error',
          code: 'TOOL_ERROR',
          message: 'Tool execution failed',
          phase: 'execution',
        },
        workspaceSessionId: 'ws_123',
        agentSessionId: 'sess_123',
      } as ProtocolEvent,
    ];

    const { result } = renderHook(() => useProcessedEvents(events));

    expect(result.current.processed).toHaveLength(1);
    expect(result.current.processed[0]).toMatchObject({
      type: 'error',
      code: 'TOOL_ERROR',
      message: 'Tool execution failed',
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/hooks/__tests__/useProcessedEvents.test.tsx --run
```

Expected: FAIL - useProcessedEvents expects LaceEvent

**Step 3: Read current implementation**

```bash
cd /Users/jesse/Documents/GitHub/lace
cat packages/web/hooks/useProcessedEvents.ts
```

**Step 4: Implement protocol event processing**

This is a large rewrite. The implementation needs to:
- Aggregate `text_delta` events by turn ID
- Pair `tool_use` pending/completed events by toolCallId
- Handle thinking, errors, and other event types

```typescript
// packages/web/hooks/useProcessedEvents.ts
import { useMemo } from 'react';
import type { AppEvent } from '@/types/app-events';
import { isProtocolEvent, isPermissionRequestEvent, isWebEvent } from '@/types/app-events';
import type { ProtocolEvent } from '@/types/protocol-events';

/**
 * Processed event types for timeline rendering
 */
export type ProcessedEventType =
  | 'message'      // Aggregated text_delta or turn_end
  | 'thinking'     // Thinking tokens
  | 'tool'         // Tool call + result pair
  | 'error'        // Error event
  | 'permission'   // Permission request
  | 'user_message' // User message
  | 'system'       // System message
  | 'metadata';    // Session info, context window, etc.

export interface ProcessedEvent {
  id: string;
  type: ProcessedEventType;
  timestamp: Date;
  agentSessionId: string;
  turnId?: string;

  // Message fields
  content?: string;
  isStreaming?: boolean;

  // Tool fields
  toolCallId?: string;
  name?: string;
  input?: unknown;
  status?: string;
  outcome?: string;
  result?: unknown;

  // Error fields
  code?: string;
  message?: string;
  phase?: string;

  // Permission fields
  resource?: string;
  options?: Array<{ optionId: string; label: string }>;

  // Raw event for debugging
  raw?: AppEvent;
}

/**
 * Hook to process raw events into timeline-friendly format
 */
export function useProcessedEvents(events: AppEvent[]): {
  processed: ProcessedEvent[];
  isLoading: boolean;
} {
  const processed = useMemo(() => {
    return processEvents(events);
  }, [events]);

  return {
    processed,
    isLoading: false,
  };
}

/**
 * Process raw events into timeline format
 */
function processEvents(events: AppEvent[]): ProcessedEvent[] {
  const processed: ProcessedEvent[] = [];
  const textDeltasByTurn = new Map<string, ProtocolEvent[]>();
  const toolCallsById = new Map<string, { call?: ProtocolEvent; result?: ProtocolEvent }>();

  // First pass: collect text deltas and tool calls
  for (const event of events) {
    if (isProtocolEvent(event)) {
      const { update } = event;

      if (update.type === 'text_delta' && update.turnId) {
        const existing = textDeltasByTurn.get(update.turnId) || [];
        existing.push(event);
        textDeltasByTurn.set(update.turnId, existing);
      } else if (update.type === 'tool_use' && update.toolCallId) {
        const existing = toolCallsById.get(update.toolCallId) || {};
        if (update.status === 'pending' || update.status === 'running') {
          existing.call = event;
        } else if (update.status === 'completed' || update.status === 'failed' || update.status === 'denied') {
          existing.result = event;
        }
        toolCallsById.set(update.toolCallId, existing);
      }
    }
  }

  // Second pass: create processed events
  for (const event of events) {
    if (isProtocolEvent(event)) {
      const processedEvent = processProtocolEvent(
        event,
        textDeltasByTurn,
        toolCallsById
      );
      if (processedEvent) {
        processed.push(processedEvent);
      }
    } else if (isPermissionRequestEvent(event)) {
      processed.push(processPermissionRequest(event));
    } else if (isWebEvent(event)) {
      const processedEvent = processWebEvent(event);
      if (processedEvent) {
        processed.push(processedEvent);
      }
    }
  }

  // Sort by timestamp
  processed.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return processed;
}

/**
 * Process a protocol event
 */
function processProtocolEvent(
  event: ProtocolEvent,
  textDeltasByTurn: Map<string, ProtocolEvent[]>,
  toolCallsById: Map<string, { call?: ProtocolEvent; result?: ProtocolEvent }>
): ProcessedEvent | null {
  const { update, agentSessionId } = event;

  switch (update.type) {
    case 'text_delta':
      // Skip - handled by turn aggregation
      if (!update.turnId) {
        // Orphaned text delta - create standalone message
        return {
          id: event.id,
          type: 'message',
          timestamp: event.timestamp,
          agentSessionId,
          content: update.text || '',
          isStreaming: false,
          raw: event,
        };
      }
      // Check if this is the last text_delta for this turn
      const turnDeltas = textDeltasByTurn.get(update.turnId) || [];
      const isLastInTurn = turnDeltas[turnDeltas.length - 1]?.id === event.id;

      if (isLastInTurn) {
        // Aggregate all text deltas for this turn
        const aggregatedText = turnDeltas
          .map(e => (e.update as any).text || '')
          .join('');

        return {
          id: `msg_${update.turnId}`,
          type: 'message',
          timestamp: turnDeltas[0].timestamp,
          agentSessionId,
          turnId: update.turnId,
          content: aggregatedText,
          isStreaming: false,
          raw: event,
        };
      }
      return null; // Not the last delta yet

    case 'thinking':
      return {
        id: event.id,
        type: 'thinking',
        timestamp: event.timestamp,
        agentSessionId,
        content: update.text || '',
        raw: event,
      };

    case 'tool_use':
      // Skip - handled by tool call aggregation
      if (!update.toolCallId) return null;

      const toolPair = toolCallsById.get(update.toolCallId);
      if (!toolPair?.call) return null;

      // Only create processed event when we have the result
      if (update.status === 'completed' || update.status === 'failed' || update.status === 'denied') {
        const callUpdate = (toolPair.call.update as any);
        const resultUpdate = update;

        return {
          id: `tool_${update.toolCallId}`,
          type: 'tool',
          timestamp: toolPair.call.timestamp,
          agentSessionId,
          turnId: update.turnId,
          toolCallId: update.toolCallId,
          name: callUpdate.name,
          input: callUpdate.input,
          status: resultUpdate.status,
          outcome: resultUpdate.result?.outcome,
          result: resultUpdate.result,
          raw: event,
        };
      }

      // Pending/running - create incomplete tool entry
      return {
        id: `tool_${update.toolCallId}`,
        type: 'tool',
        timestamp: event.timestamp,
        agentSessionId,
        turnId: update.turnId,
        toolCallId: update.toolCallId,
        name: update.name,
        input: update.input,
        status: update.status,
        raw: event,
      };

    case 'turn_end':
      // Use turn_end content if available
      if (update.content && update.content.length > 0) {
        const textContent = update.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');

        return {
          id: `msg_${update.turnId}`,
          type: 'message',
          timestamp: event.timestamp,
          agentSessionId,
          turnId: update.turnId,
          content: textContent,
          isStreaming: false,
          raw: event,
        };
      }
      return null;

    case 'error':
      return {
        id: event.id,
        type: 'error',
        timestamp: event.timestamp,
        agentSessionId,
        code: update.code,
        message: update.message,
        phase: update.phase,
        raw: event,
      };

    case 'session_info':
    case 'context_window':
    case 'compaction_start':
    case 'compaction_complete':
    case 'mcp_config_changed':
    case 'mcp_server_status':
      return {
        id: event.id,
        type: 'metadata',
        timestamp: event.timestamp,
        agentSessionId,
        content: `${update.type} event`,
        raw: event,
      };

    default:
      // Unknown protocol event type
      return {
        id: event.id,
        type: 'metadata',
        timestamp: event.timestamp,
        agentSessionId,
        content: `Unknown event: ${(update as any).type}`,
        raw: event,
      };
  }
}

/**
 * Process a permission request event
 */
function processPermissionRequest(event: PermissionRequestEvent): ProcessedEvent {
  const { request } = event;

  return {
    id: event.id,
    type: 'permission',
    timestamp: event.timestamp,
    agentSessionId: request.sessionId,
    toolCallId: request.toolCallId,
    name: request.tool,
    resource: request.resource,
    options: request.options,
    raw: event,
  };
}

/**
 * Process a web-internal event
 */
function processWebEvent(event: WebEvent): ProcessedEvent | null {
  switch (event.type) {
    case 'USER_MESSAGE_SENT':
      return {
        id: event.id,
        type: 'user_message',
        timestamp: event.timestamp,
        agentSessionId: event.agentSessionId || '',
        content: (event.data as any).content,
        raw: event,
      };

    case 'LOCAL_SYSTEM_MESSAGE':
      return {
        id: event.id,
        type: 'system',
        timestamp: event.timestamp,
        agentSessionId: event.agentSessionId || '',
        content: (event.data as any).content,
        raw: event,
      };

    default:
      // Most web events don't appear in timeline
      return null;
  }
}
```

**Step 5: Run test to verify it passes**

```bash
cd /Users/jesse/Documents/GitHub/lace
npx vitest packages/web/hooks/__tests__/useProcessedEvents.test.tsx --run
```

Expected: PASS - Event aggregation works correctly

**Step 6: Commit**

```bash
git add packages/web/hooks/useProcessedEvents.ts packages/web/hooks/__tests__/useProcessedEvents.test.tsx
git commit -m "refactor(web): rewrite useProcessedEvents for protocol events

- Aggregate text_delta events by turn ID into messages
- Pair tool_use pending/completed events by toolCallId
- Process thinking, error, and metadata events
- Handle permission requests and web events
- Create timeline-friendly ProcessedEvent format
- Sort by timestamp for correct display order"
```

---

(Continuing with remaining tasks in next response due to length...)

---

## Remaining Phases Summary

**Phase 4 (continued):**
- Task 4.3: Update useAgentEvents hook
- Task 4.4: Update useAgentTokenUsage hook

**Phase 5: Timeline Components** (10-14 hours)
- Task 5.1: Update TimelineView
- Task 5.2: Update TimelineMessage
- Task 5.3: Update AgentErrorEntry
- Task 5.4: Update other timeline components

**Phase 6: Provider Components** (4-6 hours)
- Task 6.1: Update EventStreamProvider

**Phase 7: API Routes** (2-3 hours)
- Task 7.1: Update agent history API route

**Phase 8: Debug & Testing** (6-8 hours)
- Task 8.1: Update EventStreamMonitor
- Task 8.2: Update test files and fixtures

**Phase 9: Cleanup** (1-2 hours)
- Task 9.1: Remove LaceEvent imports from web package
- Task 9.2: Update documentation

---

## Notes on Test-Driven Development

Each task follows TDD:
1. Write failing test first
2. Run test to verify failure
3. Implement minimal code to pass
4. Run test to verify pass
5. Commit

This ensures:
- All new code is tested
- Tests actually test behavior (not mocks)
- Regression protection
- Documentation through tests

---

## Rollback Strategy

If migration needs to be rolled back:

1. **Phase 1-2**: Revert commits - no UI impact
2. **Phase 3**: Revert commits - event stream broken, requires fix
3. **Phase 4+**: Feature flag approach recommended to enable safe rollback

Consider adding feature flag in Phase 3:

```typescript
// In supervisor-service.ts
const USE_PROTOCOL_EVENTS = process.env.LACE_USE_PROTOCOL_EVENTS === 'true';

if (USE_PROTOCOL_EVENTS) {
  // New path: forward protocol events
} else {
  // Old path: translate to LaceEvent
}
```

---

## Performance Considerations

- **Event aggregation**: `useProcessedEvents` may be expensive for large event lists
  - Consider memoization strategies
  - Add virtual scrolling for timeline if needed

- **SSE bandwidth**: More granular events = more network traffic
  - Monitor real-world usage
  - Consider server-side event coalescing if needed

- **Re-rendering**: Event handlers should use stable callbacks
  - All hooks use `useRef` for handlers to avoid stale closures
  - Event objects are immutable

---

## Success Validation

After completing all phases, verify:

1. ✅ Run full test suite: `npm test`
2. ✅ TypeScript compilation: `npx tsc --noEmit`
3. ✅ Lint checks: `npm run lint`
4. ✅ Load web UI and verify timeline renders correctly
5. ✅ Send messages and verify streaming works
6. ✅ Trigger tool calls and verify they display
7. ✅ Check tool approval flow works
8. ✅ Verify error events display properly
9. ✅ Check that no `@lace/agent` imports remain in web package (except tests)
10. ✅ Performance testing - no regression in timeline rendering

---

**End of Implementation Plan**
