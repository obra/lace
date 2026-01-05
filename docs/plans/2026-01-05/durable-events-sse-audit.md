# Durable Events vs SSE Forwarding Audit

Date: 2026-01-05

## Background

The Lace agent has two separate event systems:

1. **Durable Events**: Written to `events.jsonl` via `appendDurableEvent()`, persisted to disk for session resumption
2. **SSE Updates**: Sent via `session/update` JSON-RPC notifications through `emitSessionUpdate()` for real-time UI

This audit examines which durable event types exist, whether they're forwarded via SSE, and whether they *should* be.

## Source of Truth

- **Durable Events**: `packages/agent/src/storage/event-log.ts` - `appendDurableEvent()`
- **SSE Schema**: `packages/ent-protocol/src/schemas/methods.ts` - `SessionUpdateNotificationSchema`
- **Event Flow**: `packages/agent/src/server.ts`

## Durable Event Types Found

From analyzing `server.ts` calls to `appendDurableEvent()`:

| Durable Event Type | Description | Written When |
|-------------------|-------------|--------------|
| `prompt` | User input/message | User sends a prompt |
| `turn_start` | Beginning of agent turn | Turn starts processing |
| `turn_end` | End of agent turn | Turn completes (with stopReason) |
| `message` | Agent response text | Agent produces text output |
| `tool_use` | Tool call + result | Tool is invoked and completes |
| `job_started` | Background job launched | Shell or subagent job starts |
| `job_finished` | Background job ended | Shell or subagent job completes |
| `permission_requested` | Tool needs approval | Permission requested from client |
| `permission_decided` | Permission resolved | User allows/denies permission |
| `permission_cancelled` | Permission cancelled | Turn cancelled while awaiting |
| `context_injected` | System context added | `ent/session/inject` called |
| `context_compacted` | Context summarized | `ent/session/compact` called |
| `checkpoint_created` | File checkpoint made | `ent/session/checkpoint` called |
| `files_rewound` | Files restored | `ent/session/rewind` called |

## SSE Update Types

From `SessionUpdateNotificationSchema`:

| SSE Update Type | Schema | Purpose |
|-----------------|--------|---------|
| `text_delta` | `{ text: string }` | Streaming text tokens |
| `thinking` | `{ text: string }` | Extended thinking content |
| `usage` | `{ inputTokens, outputTokens, ... }` | Token usage stats |
| `mode_change` | `{ mode, previousMode }` | Plan/execute mode switch |
| `context_injected` | `{ priority, messageCount }` | Context injection notification |
| `plan` | `{ tasks: [...] }` | Task planning updates |
| `tool_use` | `{ toolCallId, name, status, result? }` | Tool execution lifecycle |
| `job_started` | `{ jobId, jobType, description? }` | Job began |
| `job_finished` | `{ jobId, outcome, exitCode? }` | Job ended |
| `job_update` | `{ jobId, channel, update }` | Job streaming output |

## Analysis: Durable Events and SSE Forwarding

### Currently BOTH Written Durably AND Sent via SSE

| Event | Durable | SSE | Notes |
|-------|---------|-----|-------|
| `tool_use` | Yes | Yes | Full lifecycle (pending -> running -> completed/failed) |
| `job_started` | Yes | Yes | Properly forwarded |
| `job_finished` | Yes | Yes | Properly forwarded |
| `context_injected` | Yes | Yes | Forwarded with priority/messageCount |

### Currently Written Durably but NOT Sent via SSE

| Event | Reason | SHOULD Send SSE? |
|-------|--------|------------------|
| `prompt` | **No** | Client already knows - they sent it |
| `turn_start` | **No** | Turn lifecycle managed by client via request/response |
| `turn_end` | **No** | Turn completion handled via `session/prompt` response |
| `message` | **Partial** | Text streamed via `text_delta`, final stored durably |
| `permission_requested` | **No** | Sent via separate `session/request_permission` RPC |
| `permission_decided` | **No** | Response to `session/request_permission` RPC |
| `permission_cancelled` | **No** | Client knows - they cancelled it |
| `context_compacted` | **Maybe** | Could notify client of successful compaction |
| `checkpoint_created` | **Maybe** | Could notify client of checkpoint creation |
| `files_rewound` | **Maybe** | Could notify client of file restoration |

### Currently Sent via SSE but NOT Written Durably

| Event | Reason | SHOULD Write Durably? |
|-------|--------|----------------------|
| `text_delta` | Streaming tokens | **No** - ephemeral, reconstructed from `message` |
| `thinking` | Extended thinking | **Maybe** - could be valuable for debugging |
| `usage` | Token counts | **Maybe** - useful for cost tracking audit |
| `mode_change` | Mode switch | **No** - captured in session config state |
| `plan` | Task planning | **Maybe** - depends on planning feature maturity |
| `job_update` | Job output streaming | **No** - written to `jobs/{jobId}.log` files |

## Recommendations

### 1. Events Correctly Handled (No Changes Needed)

- `tool_use` - Both durable and SSE, lifecycle properly represented
- `job_started` / `job_finished` - Properly synchronized
- `prompt`, `turn_start`, `turn_end` - Durable only is correct (client-initiated)
- `message` - Durable storage + streaming text_delta is correct pattern
- `permission_*` - Separate RPC channel is appropriate

### 2. Consider Adding SSE Notifications

| Event | Recommendation | Rationale |
|-------|---------------|-----------|
| `context_compacted` | **Low priority** | Client usually knows (they requested it), but async compaction might benefit |
| `checkpoint_created` | **Low priority** | Informational, not critical for UI rendering |
| `files_rewound` | **Low priority** | Client usually knows (they requested it) |

### 3. Consider Adding Durable Storage

| Event | Recommendation | Rationale |
|-------|---------------|-----------|
| `thinking` | **Low priority** | Would aid debugging, but increases storage |
| `usage` | **Medium priority** | Valuable for cost tracking audit trail |

### 4. No Action Needed

| Event | Rationale |
|-------|-----------|
| `text_delta` | Ephemeral streaming, reconstructible from `message` |
| `mode_change` | Session state captures this |
| `job_update` | Logged to separate files, SSE is for real-time only |
| `plan` | Feature-specific, current handling appropriate |

## Event Flow Summary

```
User sends prompt
  -> [DURABLE] prompt
  -> [DURABLE] turn_start

Agent streams response
  -> [SSE] text_delta (many)
  -> [DURABLE] message (final)

Agent calls tool
  -> [SSE] tool_use { status: 'pending' }
  -> [SSE] tool_use { status: 'awaiting_permission' } (if needed)
  -> [DURABLE] permission_requested (if needed)
  -> [RPC] session/request_permission -> response
  -> [DURABLE] permission_decided
  -> [SSE] tool_use { status: 'running' }
  -> [SSE] tool_use { status: 'completed', result }
  -> [DURABLE] tool_use (with full result)

Background job
  -> [DURABLE] job_started
  -> [SSE] job_started
  -> [SSE] job_update (streaming output)
  -> [DURABLE] job_finished
  -> [SSE] job_finished

Turn ends
  -> [DURABLE] turn_end { stopReason }
  -> [RPC Response] session/prompt result
```

## Conclusion

The current implementation correctly separates:
- **Durable events** for session persistence and resumption
- **SSE events** for real-time UI updates
- **RPC request/response** for permission workflows

The only potential gaps are around audit trail completeness (`usage`, `thinking`) rather than real-time rendering, which is the primary use case for SSE.

**Key insight**: Durable events serve reconstruction/resume needs, SSE serves live UI needs. They don't need 1:1 parity - they serve different purposes.
