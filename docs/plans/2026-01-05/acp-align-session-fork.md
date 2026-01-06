# Spec: ACP Session Fork Alignment

## Summary

Align Ent Protocol's session forking implementation with the ACP RFD proposal.
The ACP proposes a dedicated `session/fork` method, while Ent currently embeds
fork as an option in `session/load`.

## Current Ent Implementation

### Schema (packages/ent-protocol/src/schemas/methods.ts)

**Capabilities Declaration:**
```typescript
const AgentCapabilitiesSchema = z.object({
  // ...
  sessionResume: z.boolean().optional(),
  sessionFork: z.boolean().optional(),  // Boolean flag
  // ...
});
```

**SessionLoad with Fork Option:**
```typescript
const SessionLoadParamsSchema = z.object({
  sessionId: SessionIdSchema,
  fork: z.boolean().optional(),  // Fork embedded in session/load
}).strict();

const SessionLoadResultSchema = z.object({
  sessionId: SessionIdSchema,
  forkedFrom: SessionIdSchema.optional(),  // Returns original if forked
  messageCount: z.number(),
  lastActive: IsoTimestampSchema,
}).strict();
```

### Handler (packages/agent/src/server.ts)

```typescript
peer.onRequest('session/load', async (params: unknown) => {
  const parsed = params as { sessionId: string; fork?: boolean };
  // ...
  if (parsed.fork) throwInvalidParams('fork not implemented');  // NOT IMPLEMENTED
  // ...
});
```

**Current Capabilities Response:**
```typescript
capabilities: {
  streaming: true,
  multiTurn: true,
  // sessionFork NOT included
  // sessionResume NOT included
  // ...
}
```

## ACP RFD Design

### Capabilities Declaration

ACP uses a nested object structure for session capabilities:
```json
{
  "session": {
    "fork": {}
  }
}
```

The empty object is reserved for future options like `messageId` for checkpoint
forking.

### Dedicated Method

ACP proposes a separate `session/fork` method:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/fork",
  "params": {
    "sessionId": "sess_789xyz",
    "cwd": "...",
    "mcpServers": [...]
  }
}
```

### Parameters

- **sessionId** (required): Session to fork
- **cwd** (optional): Working directory for forked session
- **mcpServers** (optional): MCP server configuration

### Response

Returns same structure as `session/load`:
- **sessionId**: New forked session ID
- **forkedFrom**: Original session ID

## Required Changes to Align

### 1. Capabilities Schema Change

**From:**
```typescript
sessionFork: z.boolean().optional(),
```

**To:**
```typescript
session: z.object({
  fork: z.object({}).optional(),
  resume: z.object({}).optional(),
}).strict().optional(),
```


### 2. Add session/fork Method

Create new request/response schemas:

```typescript
const SessionForkParamsSchema = z.object({
  sessionId: SessionIdSchema,
  cwd: NonEmptyStringSchema.optional(),
  mcpServers: z.array(McpServerConfigSchema).optional(),
}).strict();

const SessionForkResultSchema = z.object({
  sessionId: SessionIdSchema,
  forkedFrom: SessionIdSchema,
  messageCount: z.number(),
  lastActive: IsoTimestampSchema,
}).strict();

export const SessionForkRequestSchema = z.object({
  jsonrpc: JsonRpcVersionSchema,
  id: JsonRpcIdSchema,
  method: z.literal('session/fork'),
  params: SessionForkParamsSchema,
}).strict();

export const SessionForkResponseSchema = z.object({
  jsonrpc: JsonRpcVersionSchema,
  id: JsonRpcIdSchema,
  result: SessionForkResultSchema,
}).strict();
```

### 3. Remove session/load fork Option

**Decision**: Remove `fork` parameter from `SessionLoadParamsSchema` entirely. No backward compatibility.

Clients must use the dedicated `session/fork` method.

### 4. Update Agent Capabilities Response

```typescript
capabilities: {
  streaming: true,
  multiTurn: true,
  session: {
    fork: {},
    resume: {},
  },
  // ...
}
```

### 5. Implement session/fork Handler

```typescript
peer.onRequest('session/fork', async (params: unknown) => {
  assertInitialized(state);

  const parsed = SessionForkParamsSchema.parse(params);

  // Load the source session's events
  const sourceSession = loadSession(parsed.sessionId);
  if (!sourceSession) {
    throw { code: -32602, message: 'SessionNotFound' };
  }

  // Create new session with copied events
  const forkedSession = forkSession(sourceSession, {
    cwd: parsed.cwd ?? sourceSession.workDir,
    mcpServers: parsed.mcpServers,
  });

  return {
    sessionId: forkedSession.sessionId,
    forkedFrom: parsed.sessionId,
    messageCount: forkedSession.messageCount,
    lastActive: forkedSession.lastActive,
  };
});
```

## Zod Schema Changes Summary

| Current Schema | ACP-Aligned Schema | Notes |
|----------------|-------------------|-------|
| `sessionFork: z.boolean().optional()` | `session.fork: z.object({}).optional()` | Nested object for extensibility |
| `sessionResume: z.boolean().optional()` | `session.resume: z.object({}).optional()` | Consistent with fork |
| `SessionLoadParams.fork` | Remove entirely | Use session/fork method |
| N/A | `SessionForkParamsSchema` | New method params |
| N/A | `SessionForkResultSchema` | New method result |
| N/A | `SessionForkRequestSchema` | New request schema |
| N/A | `SessionForkResponseSchema` | New response schema |

## Implementation Order

1. Add `session/fork` schemas to `methods.ts`
2. Add `session/fork` to `EntProtocolRequestSchema` union
3. Update `AgentCapabilitiesSchema` with nested session object
4. Implement `session/fork` handler in agent server
5. Update capabilities response to include `session.fork`
6. Remove `fork` parameter from `session/load`
7. Update tests

### 7. Update Protocol Documentation

1. **Update `docs/protocol-spec.md`**: Add `session/fork` method, update capabilities schema
2. **Update `docs/about-the-protocol.md`**: Document alignment with ACP RFD

## Open Questions

1. **Resume Alignment**: The ACP likely has a similar pattern for `session/resume`. Should we align that at the same time?

2. **MCP Server Semantics**: When forking with new `mcpServers`, should they replace or merge with the original session's servers?

3. **Checkpoint Forking**: The ACP reserves the fork object for future `messageId` support. Should we add a placeholder schema for this now?
