# Protocol Event Extensions Proposal

**Date**: 2026-01-05
**Author**: Bot
**Status**: Draft

## Overview

The Ent protocol currently defines streaming `session/update` types for real-time turn updates (text_delta, tool_use, usage, etc.). However, several internal Lace event types lack protocol representation. This document proposes protocol extensions to cover these gaps.

### Current LaceEvent Types Without Protocol Coverage

From `packages/agent/src/threads/types.ts`:

| LaceEvent Type | Category | Proposed Protocol Coverage |
|----------------|----------|---------------------------|
| `MCP_CONFIG_CHANGED` | Configuration | New `session/update` type |
| `MCP_SERVER_STATUS_CHANGED` | Status | New `session/update` type |
| `SESSION_UPDATED` | Metadata | New `session/update` type |
| `COMPACTION_START` | Lifecycle | New `session/update` type |
| `COMPACTION_COMPLETE` | Lifecycle | New `session/update` type |
| `AGENT_ERROR` | Error | New `session/update` type |
| `EVENT_UPDATED` | Internal | **Not recommended** |

---

## 1. MCP Configuration Changes (`mcp_config_changed`)

### Rationale

When MCP server configurations change mid-session (via `ent/mcp/servers/upsert` or `ent/mcp/servers/delete`), clients need to update their UI to reflect the new configuration. This is a transient notification, not persisted to conversation history.

### `session/update` Extension

```typescript
{
  type: "mcp_config_changed",
  serverId: string,
  action: "created" | "updated" | "deleted",
  serverConfig?: {
    name: string,
    command: string,
    args?: string[],
    enabled: boolean
  }
}
```

### Zod Schema

```typescript
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
```

### Design Notes

- `serverConfig` is optional because it's not needed for `deleted` actions
- Does NOT include `env` to avoid leaking environment secrets in streaming updates
- Clients can use `ent/mcp/servers/list` for full configuration if needed

---

## 2. MCP Server Status Changes (`mcp_server_status`)

### Rationale

When an MCP server's runtime status changes (starts, stops, fails), clients need to update connection indicators. This is distinct from configuration changes - it represents runtime lifecycle events.

### `session/update` Extension

```typescript
{
  type: "mcp_server_status",
  serverId: string,
  name: string,
  status: "stopped" | "starting" | "running" | "failed",
  error?: string,
  toolCount?: number
}
```

### Zod Schema

```typescript
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

### Design Notes

- Includes `name` for display convenience (avoids lookup)
- `toolCount` provided on successful `running` status for UI badges
- `error` present when `status: "failed"`
- This is transient (not persisted to conversation history)

---

## 3. Session Metadata Updates (`session_metadata`)

### Rationale

When session metadata changes (e.g., name/title updates from `SESSION_UPDATED`), clients need to update their session lists or headers. Currently there's no way to notify clients of these changes.

### `session/update` Extension

```typescript
{
  type: "session_metadata",
  name?: string,
  // Future extensibility for other metadata
}
```

### Zod Schema

```typescript
const SessionUpdateMetadataSchema = z
  .object({
    type: z.literal('session_metadata'),
    name: NonEmptyStringSchema.optional(),
  })
  .strict();
```

### Design Notes

- Minimal initial scope (just `name`)
- Extensible for future metadata fields without breaking changes
- This is transient - the authoritative source is `session/load` or `ent/agent/status`

---

## 4. Compaction Lifecycle (`compaction_start`, `compaction_complete`)

### Rationale

Compaction is a potentially long-running operation that affects conversation state. Clients should be able to:
1. Show a loading indicator when compaction starts
2. Update their view when compaction completes
3. Handle compaction failures gracefully

### `session/update` Extensions

**Start:**
```typescript
{
  type: "compaction_start",
  auto: boolean,    // true if triggered automatically, false if via ent/session/compact
  strategy?: "summarize" | "truncate" | "selective"
}
```

**Complete:**
```typescript
{
  type: "compaction_complete",
  success: boolean,
  previousTokens?: number,
  currentTokens?: number,
  messagesCompacted?: number,
  summary?: string,
  error?: string
}
```

### Zod Schemas

```typescript
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
```

### Design Notes

- `auto` distinguishes user-initiated (via `ent/session/compact`) from automatic compaction
- `success: false` with `error` for failures
- Token counts mirror `ent/session/compact` response for consistency
- These are transient events but provide real-time feedback during the operation

---

## 5. Agent Errors (`error`)

### Rationale

When the agent encounters errors (provider failures, tool execution errors, processing errors), clients need to be notified to:
1. Display error messages to the user
2. Show retry options where appropriate
3. Update UI state (e.g., stop loading indicators)

Currently `AGENT_ERROR` events are internal. The protocol needs a standardized error notification.

### `session/update` Extension

```typescript
{
  type: "error",
  errorType: "provider_failure" | "tool_execution" | "processing_error" | "timeout",
  message: string,
  isRetryable: boolean,
  context: {
    phase: "provider_response" | "tool_execution" | "conversation_processing" | "initialization",
    providerName?: string,
    modelId?: string,
    toolName?: string,
    toolCallId?: string
  }
}
```

### Zod Schema

```typescript
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
```

### Design Notes

- Does NOT include `stack` or `fullError` - these are internal details that shouldn't leak to protocol
- `isRetryable` helps clients decide whether to offer retry options
- `context.toolCallId` links to the relevant `tool_use` update for tool errors
- This is transient but may also warrant a durable `error` event type in `ent/session/events`

### Error Category Alignment

This aligns with the existing protocol error code design (Section 10.4 of spec):

| `errorType` | Maps to Error Code | Category |
|-------------|-------------------|----------|
| `provider_failure` | 7 (ProviderError) | Provider |
| `tool_execution` | 4 (ToolNotFound) or tool_use.status=failed | Tool |
| `processing_error` | -32603 (InternalError) | Agent internal |
| `timeout` | 6 (Cancelled) or custom | Session |

---

## 6. NOT Recommended: `EVENT_UPDATED`

### What It Is

`EVENT_UPDATED` is an internal event that tracks when an event's `visibleToModel` flag changes (typically during compaction, when events are marked as no longer visible to the model).

### Why NOT in Protocol

1. **Too low-level**: This is an implementation detail of how Lace manages context windows internally
2. **No client action required**: Clients don't need to know which specific events are hidden from the model
3. **Confusing semantics**: "Updated" suggests the event content changed, but only visibility metadata changed
4. **Covered by compaction**: The `compaction_complete` update already tells clients when context reduction happened

### Recommendation

Keep `EVENT_UPDATED` as an internal Lace event. If clients need to understand context window state, they can use `ent/session/events` with appropriate filters.

---

## 7. Updated `SessionUpdateInnerSchema` Union

To add these to the existing protocol, extend the discriminated union:

```typescript
const SessionUpdateInnerNonJobSchema = z.discriminatedUnion('type', [
  // Existing types
  SessionUpdateTextDeltaSchema,
  SessionUpdateThinkingSchema,
  SessionUpdateUsageSchema,
  SessionUpdateModeChangeSchema,
  SessionUpdateContextInjectedSchema,
  SessionUpdatePlanSchema,
  SessionUpdateToolUseSchema,
  SessionUpdateTurnStartSchema,
  SessionUpdateTurnEndSchema,

  // NEW: Proposed additions
  SessionUpdateMcpConfigChangedSchema,
  SessionUpdateMcpServerStatusSchema,
  SessionUpdateMetadataSchema,
  SessionUpdateCompactionStartSchema,
  SessionUpdateCompactionCompleteSchema,
  SessionUpdateErrorSchema,
]);
```

---

## 8. Considerations

### Transient vs Durable

All proposed event types are **transient** (streaming updates only, not persisted to conversation history). This matches their current classification in `isTransientEventType()`.

However, two warrant consideration for durability:

| Event | Durable? | Rationale |
|-------|----------|-----------|
| `error` | Consider | Errors might be worth persisting for debugging. If so, add to `ent/session/events` durable types. |
| `compaction_complete` | Consider | Knowing when/how context was compacted could help with session replay. The summary is already persisted as a COMPACTION event internally. |

### Backward Compatibility

These are additive extensions. Existing clients that don't understand new update types can safely ignore them (per JSON-RPC notification semantics).

### Capability Advertisement

Consider adding a capability flag for clients that want these updates:

```typescript
interface ClientCapabilities {
  // ... existing
  "ent/statusUpdates"?: boolean;  // Enable mcp_*, session_metadata, compaction_*, error
}
```

This allows agents to skip emitting these updates to clients that don't need them.

---

## 9. Implementation Checklist

1. [ ] Add Zod schemas to `packages/ent-protocol/src/schemas/methods.ts`
2. [ ] Extend `SessionUpdateInnerNonJobSchema` discriminated union
3. [ ] Update `session/update` documentation in `docs/protocol-spec.md`
4. [ ] Update agent to emit new update types in appropriate places
5. [ ] Consider adding `ent/statusUpdates` capability flag
6. [ ] Add tests for new schema validation

---

## Summary

| Proposed Type | Purpose | Schema Defined |
|---------------|---------|----------------|
| `mcp_config_changed` | MCP server config changes | Yes |
| `mcp_server_status` | MCP server runtime status | Yes |
| `session_metadata` | Session name/metadata updates | Yes |
| `compaction_start` | Compaction operation begins | Yes |
| `compaction_complete` | Compaction operation ends | Yes |
| `error` | Agent error notification | Yes |
| ~~`event_updated`~~ | Internal visibility tracking | **Not recommended** |
