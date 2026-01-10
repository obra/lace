# Protocol Alignment Master Plan

> **For Claude:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Align Lace's Ent protocol with ACP RFDs and eliminate legacy event
translation layers

**Architecture:** This plan covers protocol schema changes, web interface
refactoring to use protocol events directly, and documentation updates. All
changes are breaking (pre-1.0).

**Tech Stack:** TypeScript, Zod schemas, JSON-RPC, React

**Reference Docs:**

- `docs/plans/2026-01-05/acp-align-session-list.md`
- `docs/plans/2026-01-05/acp-align-session-fork.md`
- `docs/plans/2026-01-05/acp-align-session-info.md`
- `docs/plans/2026-01-05/acp-align-session-usage.md`
- `docs/plans/2026-01-05/acp-align-cancellation.md`
- `docs/plans/2026-01-05/sessionid-regex-fix.md`
- `docs/plans/2026-01-05/protocol-event-extensions-proposal.md`

---

## Task 1: Fix SessionId Regex (Foundation)

**Why first:** This prevents future superjson-style bugs. Simple, isolated
change.

**Files:**

- Modify: `packages/ent-protocol/src/ids.ts:7-13`
- Modify: `packages/ent-protocol/src/__tests__/ids.test.ts`

**Step 1: Write failing test for strict regex**

```typescript
// In ids.test.ts
describe('SessionIdSchema strict validation', () => {
  it('should accept sess_<uuid> format', () => {
    const valid = 'sess_550e8400-e29b-41d4-a716-446655440000';
    expect(() => SessionIdSchema.parse(valid)).not.toThrow();
  });

  it('should reject arbitrary alphanumeric strings', () => {
    expect(() => SessionIdSchema.parse('tmp')).toThrow();
    expect(() => SessionIdSchema.parse('private')).toThrow();
    expect(() => SessionIdSchema.parse('hello123')).toThrow();
  });

  it('should reject legacy lace_ format', () => {
    expect(() => SessionIdSchema.parse('lace_20260105_abc123')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ent-protocol/src/__tests__/ids.test.ts` Expected:
FAIL - current regex accepts everything

**Step 3: Update regex to strict format**

In `ids.ts`, change:

```typescript
export const SessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        value
      ),
    {
      message: 'sessionId must be sess_<uuid> format',
    }
  )
  .brand<'SessionId'>();
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ent-protocol/src/__tests__/ids.test.ts` Expected:
PASS

**Step 5: Build and test all packages**

Run: `npm run build && npm test` Expected: All pass

**Step 6: Commit**

```bash
git add packages/ent-protocol/src/ids.ts packages/ent-protocol/src/__tests__/ids.test.ts
git commit -m "fix(protocol): restrict SessionId regex to sess_<uuid> format

Prevents false positives where arbitrary strings like 'tmp' matched
the overly permissive regex. No backward compatibility (pre-1.0)."
```

---

## Task 2: Add Missing Protocol Event Types

**Why:** These events are actively used in web but have no protocol
representation.

**Files:**

- Modify: `packages/ent-protocol/src/schemas/methods.ts` (add after line 1538)

**Step 1: Write test for new event schemas**

Create: `packages/ent-protocol/src/__tests__/session-update-events.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  SessionUpdateSessionInfoSchema,
  SessionUpdateContextWindowSchema,
  SessionUpdateCompactionStartSchema,
  SessionUpdateCompactionCompleteSchema,
  SessionUpdateErrorSchema,
  SessionUpdateMcpConfigChangedSchema,
  SessionUpdateMcpServerStatusSchema,
} from '../schemas/methods';

describe('Extended session/update types', () => {
  it('should validate session_info update', () => {
    const update = {
      type: 'session_info',
      title: 'Test session',
      updatedAt: '2026-01-05T00:00:00.000Z',
    };
    expect(() => SessionUpdateSessionInfoSchema.parse(update)).not.toThrow();
  });

  it('should validate context_window update', () => {
    const update = {
      type: 'context_window',
      used: 50000,
      size: 200000,
    };
    expect(() => SessionUpdateContextWindowSchema.parse(update)).not.toThrow();
  });

  it('should validate compaction_start update', () => {
    const update = {
      type: 'compaction_start',
      auto: true,
    };
    expect(() =>
      SessionUpdateCompactionStartSchema.parse(update)
    ).not.toThrow();
  });

  it('should validate compaction_complete update', () => {
    const update = {
      type: 'compaction_complete',
      success: true,
      previousTokens: 100000,
      currentTokens: 50000,
    };
    expect(() =>
      SessionUpdateCompactionCompleteSchema.parse(update)
    ).not.toThrow();
  });

  it('should validate error update', () => {
    const update = {
      type: 'error',
      errorType: 'provider_failure',
      message: 'Connection timeout',
      isRetryable: true,
      context: {
        phase: 'provider_response',
      },
    };
    expect(() => SessionUpdateErrorSchema.parse(update)).not.toThrow();
  });

  it('should validate mcp_config_changed update', () => {
    const update = {
      type: 'mcp_config_changed',
      serverId: 'server1',
      action: 'created',
      serverConfig: {
        name: 'Test Server',
        command: '/bin/server',
        enabled: true,
      },
    };
    expect(() =>
      SessionUpdateMcpConfigChangedSchema.parse(update)
    ).not.toThrow();
  });

  it('should validate mcp_server_status update', () => {
    const update = {
      type: 'mcp_server_status',
      serverId: 'server1',
      name: 'Test Server',
      status: 'running',
      toolCount: 5,
    };
    expect(() =>
      SessionUpdateMcpServerStatusSchema.parse(update)
    ).not.toThrow();
  });
});
```

**Step 2: Run test to verify schemas don't exist**

Run:
`npx vitest run packages/ent-protocol/src/__tests__/session-update-events.test.ts`
Expected: FAIL - schemas not found

**Step 3: Add new event schemas**

In `packages/ent-protocol/src/schemas/methods.ts`, after
`SessionUpdateTurnEndSchema` (around line 1517), add:

```typescript
const SessionUpdateSessionInfoSchema = z
  .object({
    type: z.literal('session_info'),
    title: NonEmptyStringSchema.optional(),
    updatedAt: IsoTimestampSchema.optional(),
    _meta: z.record(z.unknown()).optional(),
  })
  .strict();

const SessionUpdateContextWindowSchema = z
  .object({
    type: z.literal('context_window'),
    used: z.number(),
    size: z.number(),
  })
  .strict();

const SessionUpdateCompactionStartSchema = z
  .object({
    type: z.literal('compaction_start'),
    auto: z.boolean(),
    strategy: z.enum(['summarize', 'truncate', 'selective']).optional(),
  })
  .strict();

const SessionUpdateCompactionCompleteSchema = z
  .object({
    type: z.literal('compaction_complete'),
    success: z.boolean(),
    previousTokens: z.number().optional(),
    currentTokens: z.number().optional(),
    messagesCompacted: z.number().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

const ErrorTypeSchema = z.enum([
  'provider_failure',
  'tool_execution',
  'processing_error',
  'timeout',
]);

const ErrorPhaseSchema = z.enum([
  'provider_response',
  'tool_execution',
  'conversation_processing',
  'initialization',
]);

const SessionUpdateErrorSchema = z
  .object({
    type: z.literal('error'),
    errorType: ErrorTypeSchema,
    message: z.string(),
    isRetryable: z.boolean(),
    context: z
      .object({
        phase: ErrorPhaseSchema,
        providerName: z.string().optional(),
        modelId: z.string().optional(),
        toolName: z.string().optional(),
        toolCallId: NonEmptyStringSchema.optional(),
      })
      .strict(),
  })
  .strict();

const SessionUpdateMcpConfigChangedSchema = z
  .object({
    type: z.literal('mcp_config_changed'),
    serverId: NonEmptyStringSchema,
    action: z.enum(['created', 'updated', 'deleted']),
    serverConfig: z
      .object({
        name: NonEmptyStringSchema,
        command: NonEmptyStringSchema,
        args: z.array(z.string()).optional(),
        enabled: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

const SessionUpdateMcpServerStatusSchema = z
  .object({
    type: z.literal('mcp_server_status'),
    serverId: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    status: z.enum(['stopped', 'starting', 'running', 'failed']),
    error: z.string().optional(),
    toolCount: z.number().optional(),
  })
  .strict();
```

**Step 4: Export new schemas**

At end of file, add exports:

```typescript
export {
  SessionUpdateSessionInfoSchema,
  SessionUpdateContextWindowSchema,
  SessionUpdateCompactionStartSchema,
  SessionUpdateCompactionCompleteSchema,
  SessionUpdateErrorSchema,
  SessionUpdateMcpConfigChangedSchema,
  SessionUpdateMcpServerStatusSchema,
};
```

**Step 5: Add to discriminated unions**

Update `SessionUpdateInnerNonJobSchema` (around line 1529):

```typescript
const SessionUpdateInnerNonJobSchema = z.discriminatedUnion('type', [
  SessionUpdateTextDeltaSchema,
  SessionUpdateThinkingSchema,
  SessionUpdateUsageSchema,
  SessionUpdateModeChangeSchema,
  SessionUpdateContextInjectedSchema,
  SessionUpdatePlanSchema,
  SessionUpdateToolUseSchema,
  SessionUpdateTurnStartSchema,
  SessionUpdateTurnEndSchema,
  // NEW:
  SessionUpdateSessionInfoSchema,
  SessionUpdateContextWindowSchema,
  SessionUpdateCompactionStartSchema,
  SessionUpdateCompactionCompleteSchema,
  SessionUpdateErrorSchema,
  SessionUpdateMcpConfigChangedSchema,
  SessionUpdateMcpServerStatusSchema,
]);
```

Update `_SessionUpdateInnerSchema` (around line 1552) similarly.

Update `SessionUpdateParamsSchema` (around line 1567):

```typescript
const SessionUpdateParamsSchema = z.discriminatedUnion('type', [
  // ... existing merges ...
  SessionUpdateBaseParamsSchema.merge(SessionUpdateSessionInfoSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateContextWindowSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateCompactionStartSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateCompactionCompleteSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateErrorSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateMcpConfigChangedSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateMcpServerStatusSchema),
]);
```

**Step 6: Run test to verify**

Run:
`npx vitest run packages/ent-protocol/src/__tests__/session-update-events.test.ts`
Expected: PASS

**Step 7: Build**

Run: `npm run build` Expected: Success

**Step 8: Commit**

```bash
git add packages/ent-protocol/src/schemas/methods.ts packages/ent-protocol/src/__tests__/session-update-events.test.ts
git commit -m "feat(protocol): add extended session/update event types

Add protocol events for:
- session_info: session metadata updates
- context_window: context utilization status
- compaction_start/complete: compaction lifecycle
- error: agent error notifications
- mcp_config_changed: MCP config CRUD
- mcp_server_status: MCP runtime status"
```

---

## Task 3: Align session/list with ACP

**Reference:** `docs/plans/2026-01-05/acp-align-session-list.md`

**Files:**

- Modify: `packages/ent-protocol/src/schemas/methods.ts:224-261`
- Modify: `packages/agent/src/server.ts` (session/list handler)
- Modify: Tests

**Step 1: Write test for aligned session/list**

In `packages/ent-protocol/src/__tests__/methods.test.ts`:

```typescript
describe('session/list ACP alignment', () => {
  it('should accept cwd parameter', () => {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/list',
      params: { cwd: '/home/user/project' },
    };
    expect(() => SessionListRequestSchema.parse(request)).not.toThrow();
  });

  it('should accept cursor parameter', () => {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/list',
      params: { cursor: 'opaque_token_123' },
    };
    expect(() => SessionListRequestSchema.parse(request)).not.toThrow();
  });

  it('should return sessions with cwd and updatedAt', () => {
    const response = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        sessions: [
          {
            sessionId: 'sess_550e8400-e29b-41d4-a716-446655440000',
            cwd: '/home/user',
            updatedAt: '2026-01-05T00:00:00.000Z',
            title: 'My session',
            created: '2026-01-05T00:00:00.000Z',
            messageCount: 5,
          },
        ],
        nextCursor: 'cursor_xyz',
      },
    };
    expect(() => SessionListResponseSchema.parse(response)).not.toThrow();
  });
});
```

**Step 2: Run test**

Run:
`npx vitest run packages/ent-protocol/src/__tests__/methods.test.ts -t "session/list"`
Expected: FAIL

**Step 3: Update SessionListParamsSchema**

```typescript
const SessionListParamsSchema = z
  .object({
    cwd: NonEmptyStringSchema.optional(), // renamed from workDir
    cursor: NonEmptyStringSchema.optional(), // added for pagination
  })
  .strict();
```

**Step 4: Update SessionListResultSchema**

```typescript
const SessionListResultSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: SessionIdSchema,
          cwd: NonEmptyStringSchema, // renamed from workDir
          title: z.string().optional(), // added
          updatedAt: IsoTimestampSchema, // renamed from lastActive
          created: IsoTimestampSchema, // Ent extension - keep
          messageCount: z.number(), // Ent extension - keep
          _meta: z.record(z.string(), z.unknown()).optional(), // added
        })
        .strict()
    ),
    nextCursor: NonEmptyStringSchema.optional(), // added for pagination
  })
  .strict();
```

**Step 5: Update agent handler**

In `packages/agent/src/server.ts`, find the `session/list` handler and update to
use new field names. Update response to include `title`, `_meta`, `nextCursor`.

**Step 6: Run tests**

Run:
`npx vitest run packages/ent-protocol/src/__tests__/methods.test.ts -t "session/list"`
Expected: PASS

**Step 7: Build**

Run: `npm run build` Expected: Success

**Step 8: Commit**

```bash
git add packages/ent-protocol/src/schemas/methods.ts packages/agent/src/server.ts packages/ent-protocol/src/__tests__/
git commit -m "feat(protocol): align session/list with ACP RFD

Breaking changes:
- workDir → cwd (param and response field)
- lastActive → updatedAt
- Add: cursor, nextCursor (pagination)
- Add: title, _meta (ACP fields)"
```

---

## Task 4: Add session/fork Method

**Reference:** `docs/plans/2026-01-05/acp-align-session-fork.md`

**Files:**

- Modify: `packages/ent-protocol/src/schemas/methods.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Write test for session/fork**

```typescript
describe('session/fork', () => {
  it('should accept sessionId and optional params', () => {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/fork',
      params: {
        sessionId: 'sess_550e8400-e29b-41d4-a716-446655440000',
        cwd: '/new/path',
      },
    };
    expect(() => SessionForkRequestSchema.parse(request)).not.toThrow();
  });

  it('should return forkedFrom in response', () => {
    const response = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        sessionId: 'sess_new',
        forkedFrom: 'sess_original',
        messageCount: 5,
        lastActive: '2026-01-05T00:00:00.000Z',
      },
    };
    expect(() => SessionForkResponseSchema.parse(response)).not.toThrow();
  });
});
```

**Step 2: Run test**

Expected: FAIL - schemas don't exist

**Step 3: Add session/fork schemas**

```typescript
const SessionForkParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
    cwd: NonEmptyStringSchema.optional(),
    mcpServers: z.array(McpServerConfigSchema).optional(),
  })
  .strict();

const SessionForkResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    forkedFrom: SessionIdSchema,
    messageCount: z.number(),
    lastActive: IsoTimestampSchema,
  })
  .strict();

export const SessionForkRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/fork'),
    params: SessionForkParamsSchema,
  })
  .strict();

export const SessionForkResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionForkResultSchema,
  })
  .strict();
```

**Step 4: Remove fork from session/load**

In `SessionLoadParamsSchema`, remove the `fork` field entirely.

**Step 5: Update capabilities schema**

Change from:

```typescript
sessionFork: z.boolean().optional(),
```

To:

```typescript
session: z
  .object({
    fork: z.object({}).strict().optional(),
    resume: z.object({}).strict().optional(),
  })
  .strict()
  .optional(),
```

**Step 6: Add to protocol union**

In `EntProtocolRequestSchema`, add `SessionForkRequestSchema`.

**Step 7: Implement handler in agent**

In `packages/agent/src/server.ts`, add `session/fork` handler (copy and adapt
session/load logic).

**Step 8: Run tests**

Expected: PASS

**Step 9: Commit**

```bash
git add packages/ent-protocol/ packages/agent/src/server.ts
git commit -m "feat(protocol): add session/fork method per ACP RFD

- Add dedicated session/fork method
- Remove fork param from session/load
- Update capabilities to nested session.fork format
- Breaking change (no backward compat)"
```

---

## Task 5: Replace session/cancel with $/cancel_request

**Reference:** `docs/plans/2026-01-05/acp-align-cancellation.md`

**Files:**

- Modify: `packages/ent-protocol/src/schemas/methods.ts`
- Modify: `packages/ent-protocol/src/schemas/jsonrpc.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Write test for $/cancel_request**

```typescript
describe('$/cancel_request', () => {
  it('should accept requestId parameter', () => {
    const notification = {
      jsonrpc: '2.0',
      method: '$/cancel_request',
      params: { requestId: 123 },
    };
    expect(() =>
      CancelRequestNotificationSchema.parse(notification)
    ).not.toThrow();
  });

  it('should accept string requestId', () => {
    const notification = {
      jsonrpc: '2.0',
      method: '$/cancel_request',
      params: { requestId: 'req_abc' },
    };
    expect(() =>
      CancelRequestNotificationSchema.parse(notification)
    ).not.toThrow();
  });
});
```

**Step 2: Run test**

Expected: FAIL

**Step 3: Add cancellation error code**

In `packages/ent-protocol/src/schemas/jsonrpc.ts`:

```typescript
// After other error codes
export const JSONRPC_ERROR_CANCELLED = -32800 as const;
```

**Step 4: Add $/cancel_request schema**

In `methods.ts`:

```typescript
const CancelRequestParamsSchema = z
  .object({
    requestId: JsonRpcIdSchema,
  })
  .strict();

export const CancelRequestNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('$/cancel_request'),
    params: CancelRequestParamsSchema,
  })
  .strict();
```

**Step 5: Remove SessionCancelNotificationSchema**

Delete the entire `SessionCancelNotificationSchema` definition.

**Step 6: Update notification union**

In `EntProtocolNotificationSchema`, replace `SessionCancelNotificationSchema`
with `CancelRequestNotificationSchema`.

**Step 7: Implement handler with auto-cascade**

In `packages/agent/src/server.ts`:

```typescript
peer.onNotification('$/cancel_request', (params: unknown) => {
  const { requestId } = CancelRequestParamsSchema.parse(params);

  // Find and cancel the request
  const request = pendingRequests.get(requestId);
  if (!request) return; // Already completed or unknown

  // Cancel the request
  request.abort();

  // Auto-cascade: cancel pending permissions
  if (request.method === 'session/prompt') {
    for (const [permId, perm] of pendingPermissions.entries()) {
      peer.notify('$/cancel_request', { requestId: permId });
    }
  }

  // Respond with -32800
  peer.sendResponse(requestId, {
    error: {
      code: JSONRPC_ERROR_CANCELLED,
      message: 'Request cancelled',
    },
  });
});
```

**Step 8: Remove session/cancel handler**

Delete the `session/cancel` handler entirely.

**Step 9: Run tests**

Expected: PASS

**Step 10: Commit**

```bash
git add packages/ent-protocol/ packages/agent/src/server.ts
git commit -m "feat(protocol): replace session/cancel with $/cancel_request

- Add $/cancel_request per-request cancellation (ACP RFD)
- Add -32800 error code for user cancellation
- Auto-cascade to pending permissions
- Remove session/cancel entirely (breaking)"
```

---

## Task 6: Add Missing HTTP Method Handlers

**Reference:** `docs/plans/2026-01-05/protocol-alignment-plan.md` Task 1

**Files:**

- Modify: `packages/supervisor/src/http/server.ts:150-294`

**Step 1: Add missing imports**

Ensure these schemas are imported from `@lace/ent-protocol`:

- `EntConnectionsTestRequestSchema`, `EntConnectionsTestResponseSchema`
- `EntSessionCompactRequestSchema`, `EntSessionCompactResponseSchema`
- `EntSessionCheckpointRequestSchema`, `EntSessionCheckpointResponseSchema`
- `EntSessionRewindRequestSchema`, `EntSessionRewindResponseSchema`
- `EntJobInjectNotificationSchema`

**Step 2: Add handlers to agentMethodHandlers**

After line 223 (connections/credentials/clear):

```typescript
  'ent/connections/test': {
    kind: 'request',
    paramsSchema: EntConnectionsTestRequestSchema.shape.params,
    resultSchema: EntConnectionsTestResponseSchema.shape.result,
  },
```

After line 183 (ent/session/events):

```typescript
  'ent/session/compact': {
    kind: 'request',
    paramsSchema: EntSessionCompactRequestSchema.shape.params,
    resultSchema: EntSessionCompactResponseSchema.shape.result,
  },
  'ent/session/checkpoint': {
    kind: 'request',
    paramsSchema: EntSessionCheckpointRequestSchema.shape.params,
    resultSchema: EntSessionCheckpointResponseSchema.shape.result,
  },
  'ent/session/rewind': {
    kind: 'request',
    paramsSchema: EntSessionRewindRequestSchema.shape.params,
    resultSchema: EntSessionRewindResponseSchema.shape.result,
  },
```

After line 243 (ent/job/kill):

```typescript
  'ent/job/inject': {
    kind: 'notify',
    paramsSchema: EntJobInjectNotificationSchema.shape.params,
  },
```

**Step 3: Build and test**

Run: `npm run build` Expected: Success

**Step 4: Commit**

```bash
git add packages/supervisor/src/http/server.ts
git commit -m "feat(supervisor): expose missing protocol methods via HTTP

Add HTTP handlers for:
- ent/connections/test
- ent/session/compact
- ent/session/checkpoint
- ent/session/rewind
- ent/job/inject (notification)"
```

---

## Task 7: Update Internal Event Types

**Why:** Replace LaceEvent types to align with protocol events.

**Files:**

- Modify: `packages/agent/src/threads/types.ts`

**Step 1: Rename event types**

In `EVENT_TYPES` array:

- `'SESSION_UPDATED'` → `'SESSION_INFO'`
- Add: `'CONTEXT_WINDOW'`
- Add: `'COMPACTION_START'` (already exists)
- Add: `'COMPACTION_COMPLETE'` (already exists)
- Add: `'AGENT_ERROR'` (already exists)
- Add: `'MCP_CONFIG_CHANGED'` (already exists)
- Add: `'MCP_SERVER_STATUS_CHANGED'` (already exists)

**Step 2: Update SessionUpdatedData**

Rename to `SessionInfoData`:

```typescript
export interface SessionInfoData {
  title: string;
  updatedAt?: Date;
  _meta?: Record<string, unknown>;
}
```

**Step 3: Add ContextWindowData**

```typescript
export interface ContextWindowData {
  used: number;
  size: number;
}
```

**Step 4: Update LaceEvent union**

Replace:

```typescript
| (BaseLaceEvent & {
    type: 'SESSION_UPDATED';
    data: SessionUpdatedData;
  })
```

With:

```typescript
| (BaseLaceEvent & {
    type: 'SESSION_INFO';
    data: SessionInfoData;
  })
| (BaseLaceEvent & {
    type: 'CONTEXT_WINDOW';
    data: ContextWindowData;
  })
```

**Step 5: Update transient types**

In `isTransientEventType()`:

- Change `'SESSION_UPDATED'` → `'SESSION_INFO'`
- Add `'CONTEXT_WINDOW'`

**Step 6: Build**

Run: `npm run build` Expected: Success (web will have errors - that's next task)

**Step 7: Commit**

```bash
git add packages/agent/src/threads/types.ts
git commit -m "refactor(agent): align event types with protocol

- Rename SESSION_UPDATED → SESSION_INFO
- Add CONTEXT_WINDOW event type
- Update data interfaces to match protocol schemas"
```

---

## Task 8: Update Web Emission Points

**Files:**

- Modify: `packages/web/app/routes/api.projects.$projectId.sessions.ts`

**Step 1: Update SESSION_UPDATED emission**

Find the broadcast call (around line 198-210) and change:

```typescript
// Before:
eventManager.broadcast({
  type: 'SESSION_UPDATED',
  data: { name: generatedName },
  context: { sessionId: workspaceSessionId, projectId },
});

// After:
eventManager.broadcast({
  type: 'SESSION_INFO',
  data: {
    title: generatedName,
    updatedAt: new Date(),
  },
  context: { sessionId: workspaceSessionId, projectId },
});
```

**Step 2: Build**

Run: `npm run build` Expected: May have type errors in event handlers - that's
next

**Step 3: Commit**

```bash
git add packages/web/app/routes/api.projects.$projectId.sessions.ts
git commit -m "refactor(web): emit SESSION_INFO instead of SESSION_UPDATED

Use title field per ACP RFD, add updatedAt timestamp"
```

---

## Task 9: Update Web Event Handlers

**Files:**

- Modify: `packages/web/hooks/useEventStream.ts`
- Modify: Any components using `onSessionUpdated`

**Step 1: Update useEventStream handler name**

In `EventHandlers` interface:

```typescript
// Before:
onSessionUpdated?: (event: LaceEvent) => void;

// After:
onSessionInfo?: (event: LaceEvent) => void;
```

**Step 2: Update case statement**

```typescript
// Before:
case 'SESSION_UPDATED':
  currentOptions.onSessionUpdated?.(event);
  break;

// After:
case 'SESSION_INFO':
  currentOptions.onSessionInfo?.(event);
  break;
```

**Step 3: Find components using onSessionUpdated**

Run: `npx grep -r "onSessionUpdated" packages/web/`

Update each usage to `onSessionInfo`.

**Step 4: Build**

Run: `npm run build` Expected: Success

**Step 5: Commit**

```bash
git add packages/web/hooks/useEventStream.ts packages/web/components/
git commit -m "refactor(web): rename onSessionUpdated → onSessionInfo"
```

---

## Task 10: Update Protocol Documentation

**Files:**

- Modify: `docs/protocol-spec.md`
- Modify: `docs/about-the-protocol.md`

**Step 1: Add new session/update types to spec**

In `docs/protocol-spec.md`, find the session/update section and add:

- `session_info`
- `context_window`
- `compaction_start` / `compaction_complete`
- `error`
- `mcp_config_changed` / `mcp_server_status`

**Step 2: Update session/list in spec**

Document field renames: `workDir` → `cwd`, `lastActive` → `updatedAt`, add
`cursor`, `title`, `_meta`.

**Step 3: Add session/fork to spec**

Document the new `session/fork` method with params and response.

**Step 4: Update cancellation in spec**

Replace `session/cancel` with `$/cancel_request`. Document `-32800` error code.

**Step 5: Update about-the-protocol.md**

Add section explaining ACP RFD alignments and intentional divergences (camelCase
vs snake_case, etc.).

**Step 6: Commit**

```bash
git add docs/protocol-spec.md docs/about-the-protocol.md
git commit -m "docs(protocol): update spec for ACP alignment

Document all protocol changes:
- New session/update types (session_info, context_window, etc.)
- session/list field renames (cwd, updatedAt, pagination)
- session/fork method
- $/cancel_request replacement for session/cancel"
```

---

## Task 11: Eliminate LaceEvent Translation Layer (Web)

**Context:** The web currently translates protocol `session/update` events to
`LaceEvent` types. Remove this translation and use protocol types directly.

**Files:**

- Modify: `packages/web/lib/server/supervisor-service.ts:56-129`
- Modify: `packages/web/lib/sse-store.ts`
- Modify: `packages/web/hooks/useProcessedEvents.ts`

**Step 1: Remove updateToLaceEvents function**

In `supervisor-service.ts`, delete the entire `updateToLaceEvents` function
(lines 56-129).

**Step 2: Update bridgeEventToWeb**

Change from calling `updateToLaceEvents` to forwarding protocol events directly:

```typescript
function bridgeEventToWeb(
  event: SupervisorServerEvent,
  params: { supervisorProjectId?: string }
) {
  if (event.type === 'session_update') {
    const manager = EventStreamManager.getInstance();
    // Forward protocol event directly with added context
    manager.broadcast({
      ...event.update,
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
    });
    return;
  }

  if (event.type === 'permission_request') {
    const manager = EventStreamManager.getInstance();
    manager.broadcast({
      type: 'permission_request',
      ...event.request,
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
    });
  }
}
```

**Step 3: Update sse-store types**

In `sse-store.ts`, change event type from `LaceEvent` to protocol event types.
Import from `@lace/ent-protocol` instead of `@lace/agent`.

**Step 4: Update useProcessedEvents**

Change to handle protocol event types:

- `text_delta` instead of `AGENT_TOKEN`
- `tool_use` instead of `TOOL_CALL` / `TOOL_RESULT`

**Step 5: Build and fix type errors**

Run: `npm run build` Fix any type errors incrementally.

**Step 6: Test**

Run: `npm test` Expected: All pass

**Step 7: Commit**

```bash
git add packages/web/lib/ packages/web/hooks/
git commit -m "refactor(web): eliminate LaceEvent translation layer

Web now consumes protocol events directly:
- Remove updateToLaceEvents translation
- Use text_delta, tool_use, etc. instead of AGENT_TOKEN, TOOL_CALL
- Import from @lace/ent-protocol, not @lace/agent"
```

---

## Task 12: Document Tool Status State Machine

**Reference:** `docs/design/tools.md` exists but doesn't document the state
machine

**Files:**

- Create: `docs/design/tool-status-state-machine.md`

**Step 1: Write state machine doc**

Create the file with:

- State diagram
- Status meanings
- Transition rules
- Examples

(Content from protocol-alignment-plan.md Task 5)

**Step 2: Reference from tools.md**

Add link in `docs/design/tools.md` to the new state machine doc.

**Step 3: Commit**

```bash
git add docs/design/tool-status-state-machine.md docs/design/tools.md
git commit -m "docs: add tool status state machine documentation

Explicitly documents tool_use status transitions:
pending → awaiting_permission → completed|failed|denied|timeout|cancelled"
```

---

## Summary

| Task                      | Type          | Effort | Breaking                     |
| ------------------------- | ------------- | ------ | ---------------------------- |
| 1. SessionId regex        | Fix           | Small  | No                           |
| 2. Protocol event types   | Extension     | Medium | No (additive)                |
| 3. session/list alignment | Schema change | Small  | Yes                          |
| 4. session/fork method    | Feature       | Medium | Yes (removes fork param)     |
| 5. $/cancel_request       | Feature       | Medium | Yes (removes session/cancel) |
| 6. HTTP handlers          | Feature       | Small  | No (additive)                |
| 7. Internal event types   | Refactor      | Small  | No (internal)                |
| 8. Web emission           | Refactor      | Small  | No (internal)                |
| 9. Web handlers           | Refactor      | Small  | No (internal)                |
| 10. Protocol docs         | Documentation | Small  | N/A                          |
| 11. LaceEvent elimination | Refactor      | Large  | No (internal)                |
| 12. State machine docs    | Documentation | Small  | N/A                          |

**Total estimated effort:** 2-3 hours of focused implementation

**All changes are breaking** - No backward compatibility maintained anywhere
(pre-1.0 project).
