# Session/Update Protocol Analysis

**Date:** 2026-01-05 **Status:** Research complete

## Overview

This document analyzes Lace's `session/update` protocol as defined in the
ent-protocol package, documenting how session events flow from agent to
supervisor to web clients, and what changes would be needed to add
`turn_start`/`turn_end` as streaming events.

---

## 1. Current Session/Update Event Types

### Defined in `packages/ent-protocol/src/schemas/methods.ts`

The `SessionUpdateNotificationSchema` defines the streaming events sent from
agent to client during turn processing.

#### Base Update Schema (Common Fields)

Every `session/update` notification includes:

```typescript
{
  sessionId: string;       // Session this update belongs to
  streamSeq: number;       // Global monotonic sequence (never resets)
  turnId?: string;         // Prompt turn that generated this update
  turnSeq?: number;        // Sequence within turn (resets each turn)
  jobId?: string;          // Background job ID (if from a job)
  type: string;            // Update type discriminant
}
```

#### Current Update Types

| Type               | Purpose                        | Key Fields                                                 |
| ------------------ | ------------------------------ | ---------------------------------------------------------- |
| `text_delta`       | Streaming text chunks          | `text: string`                                             |
| `thinking`         | Extended thinking output       | `text: string`                                             |
| `usage`            | Token/cost tracking            | `inputTokens`, `outputTokens`, `costUsd`, etc.             |
| `mode_change`      | Mode switch notification       | `mode`, `previousMode`                                     |
| `context_injected` | Context injection confirmation | `priority`, `messageCount`                                 |
| `plan`             | Task plan updates              | `tasks: Array<{ taskId, content, status, priority? }>`     |
| `tool_use`         | Tool execution lifecycle       | `toolCallId`, `name`, `kind`, `input`, `status`, `result?` |
| `job_started`      | Background job began           | `jobId`, `parentJobId?`, `jobType`, `description?`         |
| `job_finished`     | Background job ended           | `jobId`, `outcome`, `exitCode?`                            |
| `job_update`       | Nested job updates             | `jobId`, `channel?`, `update: SessionUpdateInner`          |

#### Notable Omission

**`turn_start` and `turn_end` are NOT currently in the streaming protocol**.
They exist only as:

- Durable event types (stored in `events.jsonl`)
- Referenced in protocol spec documentation (Section 6.12)

---

## 2. How Events Flow: Agent -> Supervisor -> Web

### 2.1 Agent Layer (`packages/agent/src/server.ts`)

The agent emits session updates via `emitSessionUpdate()`:

```typescript
const emitSessionUpdate = async (
  update: SessionUpdate,
  context?: { turnId?: string; turnSeq?: number; jobId?: string }
) => {
  if (!state.activeSession) return;

  await runExclusive(() => {
    const sessionState = readSessionState(state.activeSession!.dir);
    peer.notify('session/update', {
      sessionId: state.activeSession!.meta.sessionId,
      streamSeq: sessionState.nextStreamSeq,
      turnId: context?.turnId,
      turnSeq: context?.turnSeq,
      jobId: context?.jobId,
      ...update,
    });
    // Increment streamSeq for next update
    writeSessionState(state.activeSession!.dir, {
      ...sessionState,
      nextStreamSeq: sessionState.nextStreamSeq + 1,
    });
  });
};
```

Key observations:

- Uses `peer.notify()` for one-way streaming (no response expected)
- `streamSeq` is persisted to survive restarts
- Updates are wrapped with session/turn context

#### Turn Lifecycle in Agent

During `session/prompt` processing (line ~3290):

```typescript
// Durable events written but NOT streamed:
await writeAndAdvance({ type: 'turn_start', data: {} });

// ... turn processing with text_delta, tool_use updates streamed ...

await writeAndAdvance({ type: 'turn_end', data: { stopReason } });
```

The agent **writes** `turn_start`/`turn_end` as durable events but does **NOT**
emit them via `emitSessionUpdate()`.

### 2.2 Supervisor Layer (`packages/supervisor/src/`)

The supervisor acts as a process manager and event router.

#### `SupervisorAgentProcess` (supervisor-agent-process.ts)

Receives updates from agent via JSON-RPC peer:

```typescript
this.peer.onRequest('session/update', async (params) => {
  const parsed = SessionUpdateNotificationSchema.shape.params.parse(params);
  if (options.onSessionUpdate) options.onSessionUpdate(parsed);
  return undefined;
});
```

Note: Despite being handled as `onRequest`, this is semantically a notification
(returns `undefined`).

#### `Supervisor` Class (supervisor.ts)

Routes updates to registered callbacks:

```typescript
const agent = new SupervisorAgentProcess({
  laceDir: this.laceDir,
  onSessionUpdate: (update) => {
    if (!activeSessionId) return;
    if (update.sessionId !== activeSessionId) return;
    if (this.onSessionUpdate) this.onSessionUpdate(workspaceSessionId, update);
  },
  // ...
});
```

The supervisor filters updates to match the expected session and forwards to
configured handlers.

### 2.3 HTTP Server Layer (`packages/supervisor/src/http/server.ts`)

Exposes updates via Server-Sent Events (SSE):

```typescript
const supervisor = new Supervisor({
  laceDir: options.laceDir,
  onSessionUpdate: (workspaceSessionId, update) => {
    const projectId =
      supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;

    // Track pending tool calls for permission UI
    if (update.type === 'tool_use') {
      // ... tracking logic ...
    }

    // Broadcast to all SSE clients
    broadcast({
      type: 'session_update',
      workspaceSessionId,
      ...(projectId ? { projectId } : {}),
      update,
    });
  },
  // ...
});
```

SSE endpoint at `/events`:

```typescript
if (method === 'GET' && pathname === '/events') {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  // ...
  sseClients.add(res);
}
```

### 2.4 Complete Flow Diagram

```
Agent Process                    Supervisor                     Web Client
     |                               |                              |
     |  peer.notify('session/update') |                              |
     | ----------------------------> |                              |
     |                               |  onSessionUpdate callback    |
     |                               | ---------------------------> |
     |                               |                              |
     |                               |  broadcast() to SSE          |
     |                               | ---------------------------> |
     |                               |      (event: session_update) |
```

---

## 3. Durable vs Streaming Events

### Current State

| Event Type     | Durable (events.jsonl) | Streaming (session/update)                    |
| -------------- | ---------------------- | --------------------------------------------- |
| `prompt`       | Yes                    | No                                            |
| `turn_start`   | Yes                    | **No**                                        |
| `message`      | Yes                    | No (use `text_delta` for streaming)           |
| `tool_use`     | Yes                    | Yes                                           |
| `turn_end`     | Yes                    | **No**                                        |
| `text_delta`   | No                     | Yes                                           |
| `job_started`  | Yes                    | Yes                                           |
| `job_finished` | Yes                    | Yes                                           |
| `permission_*` | Yes                    | No (via `session/request_permission` request) |

### Design Rationale

The protocol spec (line 332) states:

> **Durable event guarantee**: A successful `session/prompt` response implies
> that corresponding durable events (`turn_start`, `message`, `tool_use`,
> `turn_end`) have been written and can be fetched via `ent/session/events` with
> stable ordering.

The current design treats `turn_start`/`turn_end` as **durable markers** rather
than streaming events. Clients can:

1. Use `session/prompt` response `turnId` to identify the turn
2. Fetch full turn history via `ent/session/events`

---

## 4. Changes Needed to Add turn_start/turn_end to Streaming Protocol

### 4.1 Schema Changes (`packages/ent-protocol/src/schemas/methods.ts`)

Add new update type schemas:

```typescript
const SessionUpdateTurnStartSchema = z
  .object({
    type: z.literal('turn_start'),
    turnId: NonEmptyStringSchema,
  })
  .strict();

const SessionUpdateTurnEndSchema = z
  .object({
    type: z.literal('turn_end'),
    turnId: NonEmptyStringSchema,
    stopReason: z.enum([
      'end_turn',
      'max_tokens',
      'max_turns',
      'cancelled',
      'budget_exceeded',
    ]),
  })
  .strict();
```

Update discriminated unions:

```typescript
const SessionUpdateInnerNonJobSchema = z.discriminatedUnion('type', [
  SessionUpdateTextDeltaSchema,
  SessionUpdateThinkingSchema,
  SessionUpdateUsageSchema,
  SessionUpdateModeChangeSchema,
  SessionUpdateContextInjectedSchema,
  SessionUpdatePlanSchema,
  SessionUpdateToolUseSchema,
  SessionUpdateTurnStartSchema, // ADD
  SessionUpdateTurnEndSchema, // ADD
]);
```

### 4.2 Agent Changes (`packages/agent/src/server.ts`)

After writing durable `turn_start`:

```typescript
await writeAndAdvance({ type: 'turn_start', data: {} });
await emitSessionUpdate({ type: 'turn_start', turnId }, { turnId, turnSeq: 0 });
```

Before returning from `session/prompt`:

```typescript
await writeAndAdvance({ type: 'turn_end', data: { stopReason } });
await emitSessionUpdate(
  { type: 'turn_end', turnId, stopReason },
  { turnId, turnSeq: finalTurnSeq }
);
```

### 4.3 Client Considerations

Clients currently detect turn boundaries via:

1. `session/prompt` response arrival (turn ended)
2. `text_delta` with new `turnId` (turn started)

With streaming `turn_start`/`turn_end`:

- Can show explicit "Turn started" / "Turn completed" UI
- More reliable turn boundary detection
- Consistent with `job_started`/`job_finished` pattern

### 4.4 Backward Compatibility

The addition is **backward compatible**:

- Existing clients can ignore unknown update types
- `session/prompt` response remains the authoritative completion signal
- Durable events remain unchanged

### 4.5 Where turn_start/turn_end ARE Already Used

The TUI (`packages/tui/`) already expects and handles `turn_end`:

```rust
// packages/tui/src/protocol/ent.rs
"turn_end" => {
    // Handle turn end...
}
```

However, this appears to be **reading from the fake agent fixtures** or
**anticipating future protocol support**, as the real agent doesn't emit these
streaming events yet.

---

## 5. Summary

### Current State

- `session/update` has 10 streaming event types defined in ent-protocol
- `turn_start`/`turn_end` exist only as **durable** events (written to
  events.jsonl)
- Flow: Agent -> Supervisor (process) -> HTTP Server -> SSE -> Web clients

### Gap

- No streaming notification when a turn starts or ends
- Clients must infer turn boundaries from `session/prompt` response

### Recommendation

Adding `turn_start`/`turn_end` to the streaming protocol would:

1. Provide explicit turn lifecycle events
2. Align with existing `job_started`/`job_finished` patterns
3. Enable better UI feedback during turn processing
4. Require minimal changes (schema + 2 emit calls in agent)

The TUI codebase already anticipates these events, suggesting this was planned
but not yet implemented.
