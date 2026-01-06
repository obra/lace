# ACP Session Usage Alignment Spec

**Date:** 2026-01-05
**Status:** Analysis Complete
**Related:** [RFD: Session Usage and Context Status](../../reference/acp/rfd-session-usage.md)

---

## Executive Summary

The ACP RFD proposes separating **per-turn token usage** (in `PromptResponse`) from **session-level context status** (pushed via `session/update` notifications). Our current Ent implementation partially covers this but uses different field naming and lacks the context window status notification.

---

## Current Ent Implementation

### 1. Per-Turn Usage in PromptResponse

**File:** `packages/ent-protocol/src/schemas/shared.ts:78-89`

```typescript
export const UsageInfoSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    thinkingTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .strict();
```

**Used in:**
- `SessionPromptResultSchema` (line 312) - the `session/prompt` response
- `SessionUpdateTurnEndSchema` (line 1515) - the `turn_end` notification

### 2. Session Update Usage Event

**File:** `packages/ent-protocol/src/schemas/methods.ts:1417-1427`

```typescript
const SessionUpdateUsageSchema = z
  .object({
    type: z.literal('usage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    thinkingTokens: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .strict();
```

This is a per-turn usage update sent during streaming, NOT a context window status.

### 3. Cost in PromptResponse

**File:** `packages/ent-protocol/src/schemas/methods.ts:314-321`

```typescript
cost: z
  .object({
    inputCostUsd: z.number(),
    outputCostUsd: z.number(),
    totalCostUsd: z.number(),
  })
  .strict()
  .optional(),
```

Separate from usage, more granular breakdown.

### 4. Compaction Events

**File:** `packages/agent/src/server.ts:2999-3006`

After `ent/session/compact`, we emit a durable event:

```typescript
{
  type: 'context_compacted',
  data: {
    strategy,
    targetTokens,
    preserveRecent,
    messagesCompacted,
    preserved: [...],
  }
}
```

**Note:** This is internal durability, NOT a protocol notification to the client.

---

## ACP RFD Design

### 1. Per-Turn Usage

```typescript
interface Usage {
  total_tokens: number;        // REQUIRED
  input_tokens: number;        // REQUIRED
  output_tokens: number;       // REQUIRED
  thought_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
}
```

Key differences from Ent:
- Uses `snake_case` (ACP standard) vs `camelCase` (Ent)
- `total_tokens` is REQUIRED in ACP, optional in Ent
- Cost is NOT included in usage (separate concern)

### 2. Context Window Status (NEW)

```typescript
interface UsageUpdate {
  type: "usage_update";
  used: number;   // tokens currently in context
  size: number;   // max context window
  cost?: {
    amount: number;
    currency: string;  // ISO 4217
  };
}
```

This is completely missing from Ent. We have no way to tell clients:
- How full the context window is
- What the max context size is
- When to warn about approaching limits

---

## Gap Analysis

| Feature | ACP RFD | Ent Current | Gap |
|---------|---------|-------------|-----|
| Per-turn usage | `Usage` in result | `UsageInfoSchema` | Field naming (snake_case vs camelCase) |
| total_tokens required | Yes | Optional | Need to make required |
| Context window used | `usage_update.used` | Missing | Need to add |
| Context window size | `usage_update.size` | Missing | Need to add |
| Cost currency | ISO 4217 any | USD only | Low priority |
| Update timing | Push on change | Only in results | Need notification |

---

## Required Changes

### Phase 1: Add Context Window Notification (High Priority)

**Why:** Clients need to know context utilization to warn users and trigger compaction.

#### 1.1 Add SessionUpdateContextWindow Schema

**File:** `packages/ent-protocol/src/schemas/methods.ts`

Add after `SessionUpdateUsageSchema`:

```typescript
const SessionUpdateContextWindowSchema = z
  .object({
    type: z.literal('context_window'),
    used: z.number(),      // tokens currently in context
    size: z.number(),      // max context window size
    percentage: z.number().optional(),  // convenience: used/size * 100
  })
  .strict();
```

**Note:** We deviate from ACP's `usage_update` type name to avoid confusion with our existing `usage` type which is per-turn.

#### 1.2 Register in Discriminated Unions

Add to `SessionUpdateInnerNonJobSchema` and `_SessionUpdateInnerSchema`.

#### 1.3 Emit After Compaction

**File:** `packages/agent/src/server.ts`

After `ent/session/compact` completes, emit:

```typescript
peer.notify('session/update', {
  sessionId,
  streamSeq: getNextStreamSeq(),
  type: 'context_window',
  used: currentTokens,
  size: model.contextWindow,
});
```

#### 1.4 Emit After Each Turn

In the turn completion handler, emit context window status after usage.

### Phase 2: Keep camelCase (Medium Priority)

**Decision**: Keep Ent's `camelCase` for usage fields. The Ent protocol is already an extension of ACP. Document the field mapping in protocol docs.

No migration needed - this is intentional divergence.

### Phase 3: Make totalTokens Required (Medium Priority)

Change in `UsageInfoSchema`:

```typescript
totalTokens: z.number(),  // Remove .optional()
```

Ensure all usage producers calculate this.

---

## Compaction Event Relationship

The `context_compacted` durable event and `context_window` notification serve different purposes:

| Aspect | `context_compacted` (durable) | `context_window` (notification) |
|--------|-------------------------------|----------------------------------|
| Storage | Written to `events.jsonl` | Fire-and-forget to client |
| Purpose | Audit/replay | UI updates |
| Content | Strategy, messages affected | Current utilization |
| Timing | Once per compaction | After compaction + turns |

They work together:
1. Compaction runs
2. `context_compacted` event persisted
3. `context_window` notification sent to clients
4. Clients update UI with new utilization %

---

## Zod Schema Changes Summary

### Add to `methods.ts`

```typescript
// New: Context window status notification
const SessionUpdateContextWindowSchema = z
  .object({
    type: z.literal('context_window'),
    used: z.number(),
    size: z.number(),
    percentage: z.number().optional(),
  })
  .strict();
```

### Modify Discriminated Unions

```typescript
const SessionUpdateInnerNonJobSchema = z.discriminatedUnion('type', [
  // ... existing ...
  SessionUpdateContextWindowSchema,  // Add this
]);

const _SessionUpdateInnerSchema = z.discriminatedUnion('type', [
  // ... existing ...
  SessionUpdateContextWindowSchema,  // Add this
]);

const SessionUpdateParamsSchema = z.discriminatedUnion('type', [
  // ... existing ...
  SessionUpdateBaseParamsSchema.merge(SessionUpdateContextWindowSchema),  // Add this
]);
```

### Optional: Export Type

```typescript
export type SessionUpdateContextWindow = z.infer<typeof SessionUpdateContextWindowSchema>;
```

---

## Implementation Order

1. **Schema changes** - Add `context_window` notification type
2. **Agent emission** - Emit after compaction and turns
3. **Supervisor forwarding** - Ensure notification reaches clients
4. **Client handling** - Update UI to show context utilization
5. **Update `docs/protocol-spec.md`** - Add `context_window` to session/update types, document field mapping (camelCase vs snake_case)
6. **Update `docs/about-the-protocol.md`** - Document alignment with ACP usage RFD

---

## Testing Strategy

### Unit Tests

1. Schema validation for `context_window` notification
2. Serialization/deserialization round-trip

### Integration Tests

1. After `ent/session/compact`, verify `context_window` notification emitted
2. After turn completion, verify `context_window` notification emitted
3. Verify `used` value matches actual token count

### E2E Tests

1. Start session, send message, verify context_window received
2. Run compaction, verify context_window shows reduced usage
3. Approach context limit, verify percentage increases

---

## Open Questions

1. **Should `percentage` be computed client-side or agent-side?**
   - ACP says client-side
   - We added it for convenience but could remove

2. **Should we emit `context_window` at session start?**
   - ACP says "after initialization"
   - Gives client max context size before any prompts

3. **How often to emit during long turns?**
   - Only on usage deltas? Every N tokens? Only at turn end?
   - Start with turn-end only, optimize later

---

## References

- [ACP RFD: Session Usage](../../reference/acp/rfd-session-usage.md)
- [Compaction Types](../../../packages/agent/src/compaction/types.ts)
- [Usage Schema](../../../packages/ent-protocol/src/schemas/shared.ts)
- [Session Update Schema](../../../packages/ent-protocol/src/schemas/methods.ts)
