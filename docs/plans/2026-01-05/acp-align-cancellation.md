# ACP Alignment: Request Cancellation

## Summary

Align Ent Protocol cancellation mechanism with ACP RFD "Request Cancellation
Mechanism" to support per-request cancellation via `$/cancel_request`
notification.

## Current Ent Implementation

### Location

`packages/ent-protocol/src/schemas/methods.ts`, lines 342-348

### Schema

```typescript
export const SessionCancelNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('session/cancel'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();
```

### Characteristics

1. **Session-scoped**: No parameters - cancels whatever is running in the
   current session
2. **Implicit targeting**: The notification has no ID parameter; it relies on
   connection state to know what to cancel
3. **Feature-specific**: Only applies to session operations
4. **No error code spec**: Does not define a standardized cancellation error
   code

### Registration

Found in `EntProtocolNotificationSchema` (line 1669-1674):

```typescript
export const EntProtocolNotificationSchema = z.union([
  SessionCancelNotificationSchema,
  EntSessionInjectNotificationSchema,
  EntJobInjectNotificationSchema,
  SessionUpdateNotificationSchema,
]);
```

## ACP RFD Design

### Key Changes from Current Approach

| Aspect           | Current Ent                      | ACP RFD                                    |
| ---------------- | -------------------------------- | ------------------------------------------ |
| Method name      | `session/cancel`                 | `$/cancel_request`                         |
| Scope            | Session-level                    | Per-request (by ID)                        |
| Parameter        | None (empty)                     | `{ requestId: string \| number }`          |
| Error code       | Not specified                    | `-32800` (Request Cancelled)               |
| Bidirectional    | Client -> Agent only             | Either party can send                      |
| Response options | None (it's a notification)       | Error `-32800` OR valid partial response   |
| Optional         | Implicit                         | Explicitly optional (implementations vary) |
| SDK integration  | None                             | Maps to native cancellation tokens         |

### ACP Schema

```typescript
interface CancelNotification {
  method: '$/cancel_request';
  params: {
    requestId: string | number; // ID of request to cancel
  };
}
```

### Behavior Requirements

When `$/cancel_request` is received:

1. **MUST** cancel the corresponding request and all nested activities
2. **MAY** finish sending pending notifications before responding
3. **MUST** send one of:
   - Valid response with partial results/cancellation marker
   - Error response with code `-32800`

### Error Code Definition

- **Code**: `-32800`
- **Message**: "Request cancelled"
- **Meaning**: Execution aborted due to cancellation request OR internal
  resource constraints/shutdown

## Required Changes

### 1. Add `$/cancel_request` Notification Schema

```typescript
// New cancellation notification (ACP-aligned)
const CancelRequestParamsSchema = z
  .object({
    requestId: JsonRpcIdSchema, // string | number
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

### 2. Add Cancellation Error Code

```typescript
// In jsonrpc.ts or shared.ts
export const JSONRPC_ERROR_CANCELLED = -32800;

export const JsonRpcCancelledErrorSchema = z
  .object({
    code: z.literal(-32800),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .strict();
```

### 3. Update Error Response Schema

The existing error schema needs to recognize `-32800` as a valid cancellation
error code.

### 4. Deprecate `session/cancel`

Keep `session/cancel` for backward compatibility initially, but mark it as
deprecated. Per the RFD: "it is possible that `session/cancel` could be replaced
by the more generic `$/cancel_request` in future versions of the protocol."

Options:

- **Option A**: Keep both, document `$/cancel_request` as preferred
- **Option B**: Remove `session/cancel` immediately (breaking change)
- **Recommendation**: Option A - keep both during transition

### 5. Update Notification Union

```typescript
export const EntProtocolNotificationSchema = z.union([
  SessionCancelNotificationSchema, // Keep for backward compat
  CancelRequestNotificationSchema, // Add new ACP-aligned cancellation
  EntSessionInjectNotificationSchema,
  EntJobInjectNotificationSchema,
  SessionUpdateNotificationSchema,
]);
```

### 6. Handler Implementation Changes

The supervisor/agent needs to:

1. Track in-flight request IDs
2. Handle `$/cancel_request` by looking up the request ID
3. Cascade cancellation to nested operations
4. Return either:
   - Error response with code `-32800`
   - Valid response with `stopReason: 'cancelled'`

## Zod Schema Changes Summary

### New Schemas to Add

```typescript
// 1. Cancel request notification params
const CancelRequestParamsSchema = z
  .object({
    requestId: JsonRpcIdSchema,
  })
  .strict();

// 2. Cancel request notification
export const CancelRequestNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('$/cancel_request'),
    params: CancelRequestParamsSchema,
  })
  .strict();

// 3. Cancellation error code constant
export const JSONRPC_ERROR_CANCELLED = -32800 as const;

// 4. Typed error schema for cancellation
export const CancelledErrorSchema = z
  .object({
    code: z.literal(JSONRPC_ERROR_CANCELLED),
    message: z.string().default('Request cancelled'),
    data: z.unknown().optional(),
  })
  .strict();
```

### Schemas to Modify

1. **`EntProtocolNotificationSchema`**: Add `CancelRequestNotificationSchema` to
   the union
2. **Error handling**: Ensure `-32800` is recognized in error response parsing

### Schemas to Deprecate (but keep)

1. **`SessionCancelNotificationSchema`**: Mark as deprecated, keep for backward
   compatibility

## Migration Path

### Phase 1: Add Support

1. Add `CancelRequestNotificationSchema`
2. Add `JSONRPC_ERROR_CANCELLED` constant
3. Update notification union
4. Implement handler that supports both old and new methods

### Phase 2: Update Clients

1. Update TUI client to send `$/cancel_request` instead of `session/cancel`
2. Test that agents handle both notification types

### Phase 3: Deprecation

1. Log warning when `session/cancel` is received
2. Document migration in changelog
3. Eventually remove `session/cancel` in major version

## Open Questions

1. **Session cancel semantics**: Should `session/cancel` remain as a
   session-level cancellation (cancels all requests in session) while
   `$/cancel_request` targets individual requests? The RFD suggests they can
   coexist with different semantics.

2. **Cascading behavior**: When a prompt is cancelled, should we automatically
   send `$/cancel_request` for any pending permission requests? The RFD
   mermaid diagram shows this pattern.

3. **Internal cancellation**: The RFD mentions internal cancellation (agent-side
   timeout, resource constraints). Should we use `-32800` for these cases too?

## References

- ACP RFD: `docs/reference/acp/rfd-request-cancellation.md`
- Current Ent schemas: `packages/ent-protocol/src/schemas/methods.ts`
- LSP cancel request:
  https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#cancelRequest
