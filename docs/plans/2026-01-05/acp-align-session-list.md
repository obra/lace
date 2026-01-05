# ACP Alignment: session/list

> Created: 2026-01-05
> Reference: [ACP RFD Session List](../../reference/acp/rfd-session-list.md)

## Current Ent Implementation

Location: `packages/ent-protocol/src/schemas/methods.ts` (lines 224-261)

### Request Schema

```typescript
const SessionListParamsSchema = z
  .object({
    workDir: NonEmptyStringSchema.optional(),
  })
  .strict();
```

**Parameters:**
- `workDir` (optional): Filter by working directory

### Response Schema

```typescript
const SessionListResultSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: SessionIdSchema,
          created: IsoTimestampSchema,
          lastActive: IsoTimestampSchema,
          messageCount: z.number(),
          workDir: NonEmptyStringSchema,
        })
        .strict()
    ),
  })
  .strict();
```

**Session fields:**
- `sessionId` (required): Session identifier
- `created` (required): ISO timestamp of creation
- `lastActive` (required): ISO timestamp of last activity
- `messageCount` (required): Number of messages
- `workDir` (required): Working directory

---

## ACP RFD Design

### Request Parameters

| Parameter | Type   | Description                              |
| --------- | ------ | ---------------------------------------- |
| `cwd`     | string | Filters sessions by working directory    |
| `cursor`  | string | Opaque pagination token                  |

### Response Structure

```typescript
interface SessionListResult {
  sessions: SessionInfo[];
  nextCursor?: string;
}

interface SessionInfo {
  sessionId: string;    // Required
  cwd: string;          // Required
  title?: string;       // Optional
  updatedAt?: string;   // Optional - ISO 8601
  _meta?: object;       // Optional - agent-specific
}
```

---

## Gap Analysis

### Parameter Naming

| Ent Protocol | ACP RFD  | Status       |
| ------------ | -------- | ------------ |
| `workDir`    | `cwd`    | **RENAME**   |
| -            | `cursor` | **ADD**      |

### Response Fields

| Ent Protocol   | ACP RFD     | Status         |
| -------------- | ----------- | -------------- |
| `sessionId`    | `sessionId` | OK             |
| `workDir`      | `cwd`       | **RENAME**     |
| `created`      | -           | **KEEP** (Ent) |
| `lastActive`   | `updatedAt` | **RENAME**     |
| `messageCount` | -           | **KEEP** (Ent) |
| -              | `title`     | **ADD**        |
| -              | `_meta`     | **ADD**        |
| -              | `nextCursor`| **ADD**        |

---

## Required Changes

### 1. Rename `workDir` to `cwd`

Both request parameter and response field should use `cwd` to match ACP.

### 2. Add Pagination Support

Add `cursor` request parameter and `nextCursor` response field for pagination.

### 3. Rename `lastActive` to `updatedAt`

Match ACP naming convention for timestamp of last activity.

### 4. Add Optional `title` Field

Support human-readable session names in response.

### 5. Add Optional `_meta` Field

Support agent-specific metadata passthrough.

### 6. Keep Ent Extensions

Preserve `created` and `messageCount` as Ent-specific extensions. These provide
useful information not covered by ACP core spec.

---

## Zod Schema Changes

### Updated Request Schema

```typescript
const SessionListParamsSchema = z
  .object({
    cwd: NonEmptyStringSchema.optional(),        // renamed from workDir
    cursor: NonEmptyStringSchema.optional(),     // added for pagination
  })
  .strict();
```

### Updated Response Schema

```typescript
const SessionListResultSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: SessionIdSchema,
          cwd: NonEmptyStringSchema,             // renamed from workDir
          title: z.string().optional(),          // added per ACP
          updatedAt: IsoTimestampSchema,         // renamed from lastActive
          created: IsoTimestampSchema,           // Ent extension - keep
          messageCount: z.number(),              // Ent extension - keep
          _meta: z.record(z.string(), z.unknown()).optional(),  // added per ACP
        })
        .strict()
    ),
    nextCursor: NonEmptyStringSchema.optional(), // added for pagination
  })
  .strict();
```

---

## Implementation Notes

### Breaking Changes

This is a **breaking change** to the Ent protocol:
- Field renames: `workDir` -> `cwd`, `lastActive` -> `updatedAt`
- Clients using the old field names will break

### Migration Strategy

Since Ent is pre-1.0, we can make breaking changes without deprecation period:
1. Update schema in `packages/ent-protocol/src/schemas/methods.ts`
2. Update all handler implementations
3. Update all client code
4. Update tests

### Capability Advertisement

Consider adding `sessionCapabilities: { list: {} }` to `AgentCapabilitiesSchema`
to match ACP capability advertisement pattern.
