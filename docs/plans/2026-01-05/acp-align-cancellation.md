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

### 4. Remove `session/cancel`

**Decision**: Remove `session/cancel` entirely in favor of `$/cancel_request`. No backward compatibility needed (pre-1.0).

Clients that want to cancel a session's current operation should send `$/cancel_request` with the request ID of the `session/prompt` call.

### 5. Update Notification Union

```typescript
export const EntProtocolNotificationSchema = z.union([
  CancelRequestNotificationSchema, // Replace session/cancel with this
  EntSessionInjectNotificationSchema,
  EntJobInjectNotificationSchema,
  SessionUpdateNotificationSchema,
]);
```

### 6. Handler Implementation Changes

The supervisor/agent needs to:

1. Track in-flight request IDs
2. Handle `$/cancel_request` by looking up the request ID
3. **Auto-cascade**: When a `session/prompt` is cancelled, automatically send `$/cancel_request` for all pending `session/request_permission` calls
4. Return either:
   - Error response with code `-32800` (for user-initiated cancellation via `$/cancel_request`)
   - Valid response with `stopReason: 'cancelled'`

### 7. Internal Cancellation Error Codes

**Decision**: Internal cancellations (timeouts, resource constraints) should use different error codes, NOT `-32800`.

Error code mapping:
- `-32800`: User-initiated cancellation via `$/cancel_request`
- `11` (BudgetExceeded): Budget limit reached
- Timeout-specific errors: Use appropriate error codes (not -32800)
- Resource constraints: Use appropriate error codes (not -32800)

This keeps `-32800` semantically clean: "user cancelled the request".

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

### Schemas to Remove

1. **`SessionCancelNotificationSchema`**: Delete entirely - replaced by `CancelRequestNotificationSchema`

## Implementation Plan

### 1. Remove Old, Add New

1. Remove `SessionCancelNotificationSchema` from schemas
2. Add `CancelRequestNotificationSchema`
3. Add `JSONRPC_ERROR_CANCELLED = -32800` constant
4. Update `EntProtocolNotificationSchema` union (remove session/cancel, add $/cancel_request)

### 2. Implement Request Tracking

Agent/supervisor must track in-flight requests by ID to enable cancellation.

### 3. Implement Auto-Cascade

When `session/prompt` request is cancelled:
1. Send `$/cancel_request` for all pending `session/request_permission` requests
2. Send `$/cancel_request` for any other nested requests
3. Clean up resources
4. Respond to original prompt with error `-32800` or `stopReason: 'cancelled'`

### 4. Update TUI Client

Change from `session/cancel` to `$/cancel_request` with prompt request ID.

### 5. Clarify Internal Cancellation Error Codes

Document that `-32800` is ONLY for user-initiated `$/cancel_request`. Internal cancellations use:
- `11` (BudgetExceeded)
- Other appropriate error codes
- NOT `-32800`

## Decisions Made

1. **session/cancel removed**: Replace entirely with `$/cancel_request`. No backward compatibility.

2. **Auto-cascade**: YES - automatically send `$/cancel_request` for pending permission requests when prompt cancelled (per RFD mermaid diagram pattern).

3. **Internal cancellation error codes**: NO - do NOT use `-32800` for internal cancellations. Use appropriate error codes:
   - Budget exceeded: `11` (BudgetExceeded)
   - Timeouts: Appropriate timeout error
   - Resource constraints: Appropriate error
   - Keep `-32800` semantically clean for user-initiated cancellation only

## References

- ACP RFD: `docs/reference/acp/rfd-request-cancellation.md`
- Current Ent schemas: `packages/ent-protocol/src/schemas/methods.ts`
- LSP cancel request:
  https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#cancelRequest
