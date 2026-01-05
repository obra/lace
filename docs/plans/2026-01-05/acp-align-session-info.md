# ACP Alignment: Session Info Update

**Date**: 2026-01-05
**Author**: Bot
**Status**: Draft

---

## Overview

This document specifies the alignment between our current `SESSION_UPDATED` event and the ACP draft RFD for `session_info_update`. The goal is to rename our internal event to `session_info` (matching ACP naming) and use `title` instead of `name` to match ACP field conventions.

---

## 1. Current Ent Implementation: `SESSION_UPDATED`

### Type Definition

**Location**: `packages/agent/src/threads/types.ts`

```typescript
// Session event data
export interface SessionUpdatedData {
  name: string;
}

// In LaceEvent union:
| (BaseLaceEvent & {
    type: 'SESSION_UPDATED';
    data: SessionUpdatedData;
  })
```

### Classification

- **Transient**: Yes (not persisted to database)
- Listed in `isTransientEventType()` helper

### Current Usage

**Emission**: `packages/web/app/routes/api.projects.$projectId.sessions.ts`

The event is emitted when a session name is auto-generated:

```typescript
// Emit SESSION_UPDATED event via SSE
const eventManager = EventStreamManager.getInstance();
eventManager.broadcast({
  type: 'SESSION_UPDATED',
  data: {
    name: generatedName,
  },
  context: {
    sessionId: workspaceSessionId,
    projectId,
  },
});
```

**Consumption**: `packages/web/hooks/useEventStream.ts`

```typescript
// In EventHandlers interface:
onSessionUpdated?: (event: LaceEvent) => void;

// In event routing:
case 'SESSION_UPDATED':
  currentOptions.onSessionUpdated?.(event);
  break;
```

### Problems with Current Implementation

1. **Non-standard naming**: Uses `SESSION_UPDATED` (internal Lace convention) instead of ACP's `session_info_update` or `session_info`
2. **Field naming mismatch**: Uses `name` instead of ACP's `title`
3. **Limited extensibility**: Only supports `name` field, no `updatedAt` or `_meta`

---

## 2. ACP RFD Design: `session_info_update`

**Source**: `docs/reference/acp/rfd-session-info-update.md`

### Proposal Summary

Add a `session_info_update` variant to `SessionUpdate` for dynamic session identification.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Optional | Session title for display |
| `updatedAt` | string (ISO timestamp) | Optional | When the update occurred |
| `_meta` | object | Optional | Custom metadata |

### Excluded Fields

- `sessionId` - Included in the notification envelope, not the update payload
- `cwd` - Immutable after session creation

### Use Cases

1. Auto-generating titles after initial exchanges
2. Dynamic title updates as context shifts
3. Real-time client UI updates without polling

---

## 3. Proposed Alignment

### Summary of Changes

| Aspect | Current (Ent) | ACP RFD | Aligned |
|--------|---------------|---------|---------|
| Event type | `SESSION_UPDATED` | `session_info_update` | `session_info` |
| Data field | `name` | `title` | `title` |
| Timestamp | (none) | `updatedAt` | `updatedAt` (optional) |
| Metadata | (none) | `_meta` | `_meta` (optional) |

### Rationale for `session_info` (not `session_info_update`)

The ACP RFD uses `session_info_update` as the full variant name, but our `session/update` types use shorter discriminators:

- `text_delta` (not `text_delta_update`)
- `tool_use` (not `tool_use_update`)
- `usage` (not `usage_update`)

Following this pattern, we use `session_info` as the type discriminator.

---

## 4. Zod Schema for Aligned Version

### Protocol Schema

**Location**: Add to `packages/ent-protocol/src/schemas/methods.ts` (or similar)

```typescript
import { z } from 'zod';
import { IsoTimestampSchema, NonEmptyStringSchema } from './primitives.js';

/**
 * Session info update - notifies clients of session metadata changes.
 *
 * Aligned with ACP RFD: session_info_update
 * https://agentclientprotocol.com/rfds/session-info-update.md
 *
 * All fields are optional for partial updates.
 */
export const SessionUpdateSessionInfoSchema = z
  .object({
    type: z.literal('session_info'),

    /** Display title for the session */
    title: NonEmptyStringSchema.optional(),

    /** When the metadata was updated (ISO 8601 timestamp) */
    updatedAt: IsoTimestampSchema.optional(),

    /** Extensible metadata for client-specific use */
    _meta: z.record(z.unknown()).optional(),
  })
  .strict();

export type SessionUpdateSessionInfo = z.infer<typeof SessionUpdateSessionInfoSchema>;
```

### Internal LaceEvent Type

**Location**: Update `packages/agent/src/threads/types.ts`

```typescript
// Session event data - aligned with ACP session_info_update RFD
export interface SessionInfoData {
  /** Display title for the session */
  title: string;

  /** When the metadata was updated */
  updatedAt?: Date;

  /** Extensible metadata */
  _meta?: Record<string, unknown>;
}

// In LaceEvent union - replace SESSION_UPDATED:
| (BaseLaceEvent & {
    type: 'SESSION_INFO';
    data: SessionInfoData;
  })
```

---

## 5. Required Changes

### Phase 1: Add New Type (Backward Compatible)

1. **Add protocol schema** for `SessionUpdateSessionInfoSchema`
2. **Add internal type** `SessionInfoData` alongside existing `SessionUpdatedData`
3. **Add new event type** `SESSION_INFO` to `EVENT_TYPES` array
4. **Add to transient list** in `isTransientEventType()`

### Phase 2: Migrate Emission Points

1. **Update session naming route** (`api.projects.$projectId.sessions.ts`)
   - Change `type: 'SESSION_UPDATED'` to `type: 'SESSION_INFO'`
   - Change `data: { name: generatedName }` to `data: { title: generatedName }`

2. **Add `updatedAt` field** to emissions where appropriate

### Phase 3: Migrate Consumption Points

1. **Update `useEventStream.ts`**
   - Rename handler from `onSessionUpdated` to `onSessionInfo`
   - Update case statement from `SESSION_UPDATED` to `SESSION_INFO`

2. **Update any components** using `onSessionUpdated` callback

### Phase 4: Remove Old Type (Breaking)

1. **Remove `SESSION_UPDATED`** from `EVENT_TYPES` array
2. **Remove `SessionUpdatedData`** interface
3. **Remove old case** from `useEventStream.ts`

---

## 6. Migration Path for Consumers

During the transition period (Phase 1-3), both types will coexist:

```typescript
// useEventStream.ts - temporary dual support
case 'SESSION_UPDATED':
  // Legacy support
  currentOptions.onSessionUpdated?.(event);
  currentOptions.onSessionInfo?.(event); // Forward to new handler
  break;
case 'SESSION_INFO':
  currentOptions.onSessionInfo?.(event);
  break;
```

This allows gradual migration of consumers before Phase 4 cleanup.

---

## 7. Example Emissions

### Before (Current)

```typescript
eventManager.broadcast({
  type: 'SESSION_UPDATED',
  data: {
    name: generatedName,
  },
  context: {
    sessionId: workspaceSessionId,
    projectId,
  },
});
```

### After (Aligned)

```typescript
eventManager.broadcast({
  type: 'SESSION_INFO',
  data: {
    title: generatedName,
    updatedAt: new Date(),
  },
  context: {
    sessionId: workspaceSessionId,
    projectId,
  },
});
```

---

## 8. Wire Format (JSON-RPC)

When sent via the Ent protocol's `session/update` notification:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "lace_20260105_abc123",
    "update": {
      "type": "session_info",
      "title": "Refactoring authentication module",
      "updatedAt": "2026-01-05T15:30:00.000Z"
    }
  }
}
```

---

## 9. Considerations

### ACP RFD is Draft Status

The ACP RFD for `session_info_update` is still a draft. If the final ACP spec changes field names or structure, we may need to adjust. However, aligning now:

- Reduces future migration effort
- Demonstrates ACP alignment intent
- Provides better extensibility than current implementation

### Backward Compatibility

Phase 1-3 maintain backward compatibility. Only Phase 4 is breaking. This allows:

- Existing clients to continue working during migration
- Gradual consumer updates
- Testing of new format before removing old

### No Database Migration Needed

`SESSION_UPDATED` is transient (not persisted), so no database migration is required.

---

## 10. Implementation Checklist

- [ ] Add `SessionUpdateSessionInfoSchema` to protocol schemas
- [ ] Add `SESSION_INFO` to `EVENT_TYPES` array
- [ ] Add `SessionInfoData` interface
- [ ] Add `SESSION_INFO` to `isTransientEventType()`
- [ ] Update session naming route to emit `SESSION_INFO`
- [ ] Add `onSessionInfo` handler to `useEventStream.ts`
- [ ] Add dual-routing for migration period
- [ ] Update any components using the handler
- [ ] Remove `SESSION_UPDATED` after migration complete
- [ ] Add tests for new schema validation
