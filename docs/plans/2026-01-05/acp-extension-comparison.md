# ACP Extension Comparison

**Date**: 2026-01-05
**Purpose**: Compare our proposed protocol extensions with ACP to identify overlap and Ent-specific additions.

**ACP Reference Docs**: `docs/reference/acp/`

---

## Summary

| Proposed Extension | ACP Equivalent | Status |
|--------------------|----------------|--------|
| `mcp_config_changed` | None | **Ent-specific** |
| `mcp_server_status` | None | **Ent-specific** |
| `session_metadata` | Draft RFD: "Session Info Update" | **Ent-specific** (ACP considering) |
| `compaction_start` | None | **Ent-specific** |
| `compaction_complete` | Draft RFD: "Session Usage and Context Status" | **Ent-specific** (ACP considering) |
| `error` | Tool `failed` status only | **Ent-specific** (broader scope) |

---

## Detailed Comparison

### 1. `mcp_config_changed` - **Ent-Specific**

**Our Proposal**: Notify clients when MCP server configurations change mid-session.

**ACP Status**: No equivalent. ACP accepts `mcpServers` during `session/new` and `session/load` but has no notification for runtime config changes.

**Recommendation**: Keep as Ent-specific extension. ACP treats MCP config as session-setup-time only.

---

### 2. `mcp_server_status` - **Ent-Specific**

**Our Proposal**: Notify clients of MCP server runtime status (stopped, starting, running, failed).

**ACP Status**: No equivalent. ACP has no mechanism for reporting MCP server health after session creation.

**Recommendation**: Keep as Ent-specific extension. This is valuable for long-running sessions where MCP servers may start/stop dynamically.

---

### 3. `session_metadata` - **Ent-Specific** (ACP Considering)

**Our Proposal**: Notify clients when session metadata (name, etc.) changes.

**ACP Status**: Draft RFD "Session Info Update" exists, suggesting ACP recognizes the need but hasn't finalized an approach.

**Recommendation**: **Rename to `session_info`** to align with ACP RFD naming. Use `title` instead of `name` to match ACP field naming:

```typescript
// Aligned with ACP RFD
const SessionUpdateSessionInfoSchema = z.object({
  type: z.literal('session_info'),
  title: z.string().optional(),
  updatedAt: IsoTimestampSchema.optional(),
}).strict();
```

---

### 4. `compaction_start` / `compaction_complete` - **Ent-Specific** (ACP Considering Related)

**Our Proposal**: Lifecycle notifications for context compaction operations.

**ACP Status**:
- No direct equivalent for compaction notifications
- Draft RFD "Session Usage and Context Status" addresses context window status, which is tangentially related

**Analysis**: ACP's RFD focuses on reporting current usage/status rather than compaction lifecycle events. Our approach is more granular, providing start/complete events for UI feedback during potentially long operations.

**Recommendation**: Keep as Ent-specific extension. Our `compaction_start`/`compaction_complete` pattern provides better UX than just status polling. Consider aligning field names with ACP's eventual "Session Usage and Context Status" for consistency.

---

### 5. `error` - **Ent-Specific** (Broader Scope Than ACP)

**Our Proposal**: General agent error notification with typed error categories:
- `provider_failure`
- `tool_execution`
- `processing_error`
- `timeout`

**ACP Status**:
- Tool failures use `tool_call_update` with `status: "failed"`
- JSON-RPC errors for method failures
- No streaming notification for agent-level errors

**Analysis**: ACP handles tool errors narrowly (via tool_call_update) and RPC errors via JSON-RPC conventions. Our `error` type covers a broader category of runtime errors that aren't tied to specific tool calls or RPC methods.

**Recommendation**: Keep as Ent-specific extension. The `error` update type fills a gap for:
- Provider failures during streaming (not tied to a tool call)
- Processing errors that don't map to RPC error responses
- Timeout notifications during long operations

---

## ACP Patterns to Adopt

Based on ACP's design, we should consider aligning these patterns:

### 1. **Discriminator Field Naming**

ACP uses `sessionUpdate` as the discriminator:
```json
{ "sessionUpdate": "tool_call", ... }
```

Our proposal uses `type`:
```json
{ "type": "mcp_config_changed", ... }
```

**Recommendation**: Our `type` field is fine - it's consistent with our existing Ent protocol design. No change needed.

### 2. **Minimal Update Payloads**

ACP emphasizes "only the fields being changed need to be included" in update notifications.

**Recommendation**: Ensure our extensions follow this pattern. For example, `mcp_config_changed` with `action: "deleted"` correctly omits `serverConfig`.

### 3. **Capability Advertisement**

ACP uses capability flags to indicate feature support.

**Recommendation**: Our proposed `ent/statusUpdates` capability flag aligns well with this pattern. Consider naming it more specifically if we want granular control:
```typescript
interface ClientCapabilities {
  "ent/mcpStatusUpdates"?: boolean;      // mcp_config_changed, mcp_server_status
  "ent/sessionMetadataUpdates"?: boolean; // session_metadata
  "ent/compactionUpdates"?: boolean;      // compaction_start, compaction_complete
  "ent/errorUpdates"?: boolean;           // error
}
```

Or keep a single flag if we expect clients to want all-or-nothing.

### 4. **Session ID in Updates**

ACP includes `sessionId` in every `session/update`:
```json
{
  "params": {
    "sessionId": "sess_abc123",
    "update": { ... }
  }
}
```

**Recommendation**: Verify our Ent protocol follows this pattern for multi-session scenarios.

---

## Conclusion

All six proposed extensions are **Ent-specific** with no direct ACP equivalents. Two have related ACP RFDs under discussion:

| Extension | ACP RFD | Priority to Monitor |
|-----------|---------|---------------------|
| `session_metadata` | Session Info Update | Medium |
| `compaction_complete` | Session Usage and Context Status | Low |

Our extensions fill genuine gaps in ACP's current design, particularly around:
- **MCP lifecycle management** (config changes, server status)
- **Compaction operations** (explicit start/complete events)
- **Broad error reporting** (beyond tool failures)

The design patterns in our proposal already align well with ACP conventions. No significant changes needed for consistency.
