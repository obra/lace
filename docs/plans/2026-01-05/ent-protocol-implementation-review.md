# Ent Protocol Implementation Review

Date: 2026-01-05

## Executive Summary

This document compares the Ent protocol specification (`docs/protocol-spec.md`) and design document (`docs/about-the-protocol.md`) against the actual implementation in `packages/ent-protocol/` and `packages/supervisor/`. Overall, the implementation is **substantially complete** with well-defined Zod schemas that closely match the specification. However, there are several gaps and alignment issues that should be addressed.

## What's Implemented

### Fully Implemented (Schema + Types)

| Category | Methods | Status |
|----------|---------|--------|
| **Initialization** | `initialize` | Complete |
| **Session Management** | `session/new`, `session/load`, `session/list`, `session/prompt`, `session/cancel`, `session/set_mode` | Complete |
| **Agent Status** | `ent/agent/ping`, `ent/agent/status` | Complete |
| **Session Operations** | `ent/session/compact`, `ent/session/configure`, `ent/session/rewind`, `ent/session/checkpoint`, `ent/session/inject`, `ent/session/events` | Complete |
| **Provider/Connection** | `ent/providers/list`, `ent/connections/*`, `ent/connections/credentials/*`, `ent/models/list`, `ent/models/refresh` | Complete |
| **Jobs** | `ent/job/list`, `ent/job/output`, `ent/job/kill`, `ent/job/inject` | Complete |
| **Discovery** | `ent/tools/list`, `ent/personas/list` | Complete |
| **MCP** | `ent/mcp/servers/*`, `ent/mcp/tools/list` | Complete |
| **Workspace** | `ent/workspace/info`, `ent/workspace/create` | Complete |
| **Notifications** | `session/update`, `session/request_permission` | Complete |

### Sequence Numbering

The specification defines three sequence numbers for ordering and correlation:

1. **`streamSeq`**: Global sequence across ALL streaming updates
2. **`turnSeq`**: Sequence within a single turn (resets per turn)
3. **`eventSeq`**: Global sequence for durable events (for history pagination)

**Implementation Status:**
- `SessionUpdateBaseParamsSchema` in `methods.ts` correctly includes `sessionId`, `streamSeq`, `turnId?`, `turnSeq?`, and `jobId?` - **matches spec**
- `EntSessionEventsResponseSchema` includes `eventSeq`, `timestamp`, `turnId?`, `turnSeq?` per event - **matches spec**
- The schemas correctly model the correlation requirements from Section 5 of `about-the-protocol.md`

### session/update Types

All update types from the spec are implemented:
- `text_delta`, `thinking`, `usage`, `mode_change`, `context_injected`, `plan`, `tool_use`
- `job_started`, `job_finished`, `job_update`
- `turn_start`, `turn_end`

The `job_update` wrapper correctly restricts inner types via `SessionUpdateInnerNonJobSchema` to prevent recursive nesting (as specified in Section 7.1).

### session/request_permission

The implementation correctly models:
- Correlation fields: `sessionId`, `turnId`, `turnSeq`, `jobId?`
- Tool identification: `toolCallId`, `tool`, `kind?`, `resource`, `options`
- Response: `decision`, `updatedInput?`
- The `requestedAt` field is included in the params schema

## Gaps Found

### 1. PersonaInfo Schema Mismatch

**Spec (Section 6.26):**
```typescript
interface PersonaInfo {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}
```

**Implementation (`shared.ts`):**
```typescript
export const PersonaInfoSchema = z.object({
  name: NonEmptyStringSchema,
  isUserDefined: z.boolean(),
  path: NonEmptyStringSchema,
}).strict();
```

**Gap:** The implementation lacks `id`, `description`, and `tags` fields but adds `isUserDefined` and `path` which aren't in the spec. These may be Lace-specific additions, but if so, the spec should document them.

**Recommendation:** Either update the spec to reflect the actual implementation, or align the implementation with the spec. The current implementation seems designed for a file-based persona system, which may be the correct design for Lace.

### 2. ent/connections/test Missing

**Spec (Section 6.18):** Defines `ent/connections/test` for testing connectivity.

**Implementation:**
- Schema exists in `methods.ts` (`EntConnectionsTestRequestSchema`, `EntConnectionsTestResponseSchema`)
- **Not registered** in `agentMethodHandlers` in `server.ts`

**Recommendation:** Add to `agentMethodHandlers` in `server.ts`:
```typescript
'ent/connections/test': {
  kind: 'request',
  paramsSchema: EntConnectionsTestRequestSchema.shape.params,
  resultSchema: EntConnectionsTestResponseSchema.shape.result,
},
```

### 3. ent/session/compact and ent/session/checkpoint Not Exposed via HTTP

**Spec:** These are core state operations.

**Implementation:**
- Schemas exist (`EntSessionCompactRequestSchema`, `EntSessionCheckpointRequestSchema`)
- **Not registered** in `agentMethodHandlers` in `server.ts`

**Recommendation:** Add to `agentMethodHandlers`:
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
```

### 4. ent/session/rewind Not Exposed via HTTP

**Spec (Section 6.4):** Defines file checkpointing with `toEventSeq` parameter.

**Implementation:**
- Schema exists (`EntSessionRewindRequestSchema`)
- **Not registered** in `agentMethodHandlers`

**Recommendation:** Add to `agentMethodHandlers`.

### 5. ent/job/inject Not Exposed via HTTP

**Spec (Section 6.9):** Allows injecting context into a running job/subagent.

**Implementation:**
- Schema exists as notification (`EntJobInjectNotificationSchema`)
- **Not registered** in `agentMethodHandlers`

**Recommendation:** Add to `agentMethodHandlers` as a `notify` handler.

### 6. Idempotency/Response Caching Not Implemented

**Spec (Section 3.2):**
> Response caches are bounded to prevent unbounded memory growth:
> - Cache size: Up to 1000 recent request IDs per direction
> - Eviction: LRU (least recently used)
> - Scope: Per-session (cache cleared on session end)

**Implementation:** The `JsonRpcPeer` class doesn't implement response caching for idempotent retries.

**Impact:** Low for most use cases, but could matter for unreliable transports.

**Recommendation:** Document as a known limitation or implement LRU cache in `JsonRpcPeer`.

### 7. Error Code Constants Not Exported

**Spec (Section 10):** Defines specific error codes (e.g., `SessionNotFound = 1`, `ProviderError = 7`).

**Implementation:** `errors.ts` exists but only has basic structure. The error codes from the spec are not explicitly defined as constants.

**Recommendation:** Add exported constants for error codes to ensure consistency.

### 8. session/update Notification vs Request Semantics

**Spec (Section 7.1):** `session/update` is a notification (fire-and-forget).

**Implementation (`supervisor-agent-process.ts`):**
```typescript
this.peer.onRequest('session/update', async (params) => {
  // ...
});
```

**Gap:** The implementation registers it as a request handler, not a notification handler. This works because the peer handles both, but semantically notifications should not expect responses.

**Recommendation:** Consider adding a dedicated `onNotification` handler or documenting this as intentional for robustness.

## Supervisor Implementation Review

### Correctly Implemented

1. **Permission Flow:** The supervisor correctly:
   - Receives `session/request_permission` requests from agent
   - Stores pending permissions with `toolCallId`
   - Broadcasts to SSE clients
   - Handles resolution with deduplication via `permissionKey()`
   - Has 5-minute timeout for unresolved permissions

2. **Session Update Forwarding:** The supervisor:
   - Receives `session/update` notifications
   - Enriches with `workspaceSessionId` and `projectId`
   - Broadcasts to SSE clients
   - Tracks pending tool calls for permission correlation

3. **Protocol Method Passthrough:** The `agent/request` and `agent/notify` endpoints correctly:
   - Validate params against Ent protocol schemas
   - Forward to agent peer
   - Validate results against response schemas

### Issues

1. **session/update Handled as Request:** Same issue as noted above - the agent process registers `session/update` as a request handler when it should be a notification.

2. **Permission Resolution Uses toolCallId Only:** The current implementation resolves permissions by `workspaceSessionId` + `toolCallId`. The spec says `toolCallId` should be globally unique within a session across parent and all jobs/subagents. This is correct, but the implementation should verify uniqueness.

3. **No Reconnection State Sync:** The spec's design for `ent/agent/status` and `ent/session/events` is specifically for reconnection scenarios (Section 7). The supervisor HTTP server doesn't have explicit reconnection handling - it relies on SSE for live updates but doesn't have a "catch up" mechanism if events were missed.

**Recommendation:** Document the expected client behavior for reconnection (call `ent/agent/status` then `ent/session/events` to catch up).

## Summary of Recommendations

### High Priority

1. **Add missing methods to HTTP server's `agentMethodHandlers`:**
   - `ent/connections/test`
   - `ent/session/compact`
   - `ent/session/checkpoint`
   - `ent/session/rewind`
   - `ent/job/inject` (as notify)

2. **Align PersonaInfo schema** with spec or update spec to match implementation

### Medium Priority

3. **Export error code constants** from `errors.ts`

4. **Document reconnection protocol** for clients

5. **Consider `session/update` notification semantics** - clarify whether request/response pattern is intentional for reliability

### Low Priority

6. **Implement idempotent response caching** in `JsonRpcPeer` (spec recommends but not required)

7. **Add toolCallId uniqueness validation** in supervisor

## Conclusion

The Ent protocol implementation is well-structured with comprehensive Zod schemas that closely follow the specification. The main gaps are:
1. Several methods defined in schemas but not exposed via the HTTP supervisor server
2. Minor schema misalignment for `PersonaInfo`
3. Missing error code exports

The sequence numbering design from Section 5 of `about-the-protocol.md` is correctly implemented, and the supervisor properly handles the permission request/response flow with appropriate correlation and timeout handling.
