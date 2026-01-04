# Ent Protocol Specification

A JSON-RPC 2.0 protocol for agent-client communication. Designed for ACP compatibility while supporting the full Claude Agent SDK feature set.

See [about-the-protocol.md](about-the-protocol.md) for design decisions and rationale.

**Design Principles:**
1. ACP-compatible where possible (same method names, params, semantics)
2. Agent-centric execution (agent has direct FS/terminal access)
3. Extensions prefixed with `ent/` for non-ACP features
4. Full Claude Agent SDK capability coverage

---

## 1. Process and Session Model

**One process = one conversation stream.** Each agent process handles exactly one session at a time.

- `initialize` is called once when the process starts
- `session/new` or `session/load` establishes the active session
- The process serves that session until it exits
- To work with multiple sessions concurrently, spawn multiple agent processes

This design ensures clean isolation: each agent process has its own conversation state, tool permissions, and resource handles.

**Terminology note**: In this protocol, "session" refers to a single agent conversation stream (prompt/response turns with shared context). In higher-level products (e.g., Lace), a protocol `sessionId` typically maps to an agent identifier—one conversation with one agent. If your product has a broader "session" concept (e.g., a workspace grouping multiple agents), that grouping is outside this protocol's scope and should use a different term to avoid confusion.

**Subagent spawning**: When an agent spawns subagents (via Task tool or similar), the **agent process** is responsible for spawning and managing subagent processes. The supervisor/client sees subagents as background jobs via `ent/job/*` methods. Subagent IDs are agent-generated (prefixed with `job_agent_`). The supervisor does NOT spawn subagent processes directly—it only monitors them through the protocol.

```
Supervisor/Client
      │
      ▼ (spawns)
  Agent Process ◄──── owns subagent lifecycle
      │
      ├──▶ (spawns) Subagent Process 1 (job_agent_1)
      ├──▶ (spawns) Subagent Process 2 (job_agent_2)
      └──▶ (spawns) Background Shell (job_shell_1)
```

**Design choice**: This "subagents as jobs" model means subagents are not first-class protocol peers—you cannot send `session/prompt` directly to a subagent. This is intentional for v1: it simplifies the protocol and matches the common case where subagents run autonomously and return results. If interactive multi-agent collaboration becomes a requirement, future protocol versions could add "subagent = full protocol peer" where the supervisor can connect to subagent processes directly.

**Note**: `session/list` queries available sessions on disk without loading them. It does not imply multi-session support within a single process.

### Non-goals (v1)

To prevent future drift, these are explicitly **not** goals for this protocol version:

1. **Subagents as protocol peers**: Subagents are async jobs, not direct protocol peers. Clients cannot send `session/prompt` to a subagent. Use `ent/job/inject` to provide context to running jobs.

2. **Offline history mirroring**: Browsing history requires live connectivity. The protocol does not define a sync/replication mechanism for offline access.

3. **Multi-session per process**: Each process handles one conversation stream. For multiple concurrent sessions, spawn multiple processes.

---

## 2. Transport

- **Format**: Newline-delimited JSON (NDJSON)
- **Encoding**: UTF-8
- **Transport**: stdin/stdout (required), HTTP/SSE (optional)
- **Direction**: Bidirectional

**Stdout is protocol-only**: When using stdio transport, stdout MUST contain only JSON-RPC messages. All logs, diagnostics, and debug output MUST go to stderr. This ensures clean message parsing.

### 2.1 Naming Conventions

Follow ACP naming patterns for maximum compatibility:

| Pattern | Example | Rationale |
|---------|---------|-----------|
| `Id` suffix for identifiers | `sessionId`, `turnId`, `jobId`, `toolCallId`, `providerId`, `modelId`, `connectionId` | ACP convention; prevents "wrong id" wiring bugs |
| Opaque strings | `sessionId: "sess_abc123"` | Clients treat identifiers as opaque; no parsing |
| camelCase | `sessionId`, `toolCallId` | Matches JSON/JavaScript conventions |
| Verb phrases for methods | `session/prompt`, `ent/connections/credentials/start` | Action-oriented naming |

**Identifier opacity**: All identifier fields (`sessionId`, `turnId`, `jobId`, `toolCallId`/`toolUseId`, `providerId`, `modelId`, `connectionId`, `checkpointId`, `taskId`, `optionId`, `requestId`) are opaque strings. Clients MUST NOT parse, validate, or assume structure in these values. Note: `eventSeq` is a numeric sequence, not an opaque string. Note: `toolCallId` and `toolUseId` are the same identifier (see §8.1).

**Ent extensions**: Methods prefixed with `ent/` are protocol extensions not in ACP. The prefix makes it clear which parts are standard vs extended.

---

## 3. Message Types

Standard JSON-RPC 2.0:

```typescript
interface Request {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: object;
}

interface Response {
  jsonrpc: "2.0";
  id: string | number;
  result?: object;
  error?: { code: number; message: string; data?: any };
}

interface Notification {
  jsonrpc: "2.0";
  method: string;
  params?: object;
}
```

### 3.1 ID Namespacing

To prevent ID collision, client and agent use distinct ID spaces:
- **Client IDs**: Positive integers or strings starting with `c_`
- **Agent IDs**: Negative integers or strings starting with `a_`

### 3.2 Idempotency and Retries

- **Requests**: Retrying a request with the same `id` is safe; the recipient returns the cached response.
- **Permission responses**: `toolCallId` is globally unique within a session (across parent agent and all jobs/subagents). Duplicate responses for the same `toolCallId` are ignored.
- **Notifications**: Fire-and-forget. Duplicates may cause redundant processing but should not corrupt state.

**Caching bounds**: Response caches are bounded to prevent unbounded memory growth:
- Cache size: Up to 1000 recent request IDs per direction
- Eviction: LRU (least recently used)
- Scope: Per-session (cache cleared on session end)

Implementations SHOULD NOT rely on cached responses for requests older than the cache size.

---

## 4. Capability Negotiation

### 4.1 Client Capabilities

```typescript
interface ClientCapabilities {
  // ACP standard
  streaming?: boolean;           // Can handle streaming updates
  permissions?: boolean;         // Can handle permission requests
  images?: boolean;              // Can handle image content

  // We declare these FALSE (agent handles internally)
  fileSystem?: false;            // Agent has direct FS access
  terminal?: false;              // Agent has direct terminal access

  // Ent extensions
  "ent/contextInjection"?: boolean;  // Supports session/inject
  "ent/backgroundJobs"?: boolean;    // Supports job/* methods
  "ent/jobStreaming"?: "full" | "coalesced" | "none";  // Job output verbosity preference
}
```

### 4.2 Agent Capabilities

```typescript
interface AgentCapabilities {
  // ACP standard
  streaming: boolean;
  multiTurn: boolean;
  sessionResume?: boolean;
  sessionFork?: boolean;
  modes?: string[];              // ["ask", "architect", "code"]

  // Tools
  tools: ToolInfo[];

  // State operations (each maps to a protocol method)
  // Client uses these to know which ent/session/* methods are available
  operations?: {
    compact?: boolean;           // ent/session/compact
    checkpoint?: boolean;        // ent/session/checkpoint
    rewind?: boolean;            // ent/session/rewind
    configure?: boolean;         // ent/session/configure
  };

  // Conversation commands (sent via session/prompt)
  // For autocomplete, help display
  slashCommands?: SlashCommand[];

  // Ent extension feature flags
  "ent/contextInjection": boolean;
  "ent/backgroundJobs": boolean;
  "ent/fileCheckpointing": boolean;
  "ent/structuredOutput": boolean;

  // Provider/connection configuration capabilities (optional)
  "ent/providers"?: {
    list: boolean;            // supports ent/providers/list
    connections: boolean;     // supports ent/connections/*
    models: boolean;          // supports ent/models/*
    catalogRefresh?: boolean; // supports ent/models/refresh (optional)
  };
}

interface SlashCommand {
  name: string;           // "commit"
  description: string;    // "Create a git commit"
  inputHint?: string;     // "-m <message>"
}
```

---

## 5. Methods: Client → Agent

### 5.1 `initialize` (ACP-compatible)

```typescript
// Request
{
  method: "initialize",
  params: {
    protocolVersion: "1.0",
    clientInfo: {
      name: string,
      version: string
    },
    capabilities: ClientCapabilities,

    // Configuration
    config?: {
      providerId?: string,         // Provider family (opaque string, e.g., "anthropic", "openai", "claude-code-wrapper")
      connectionId?: string,       // Configured connection (preferred; implies providerId)
      modelId?: string,            // Model identifier (opaque string)
      executionMode?: string,      // "plan" | "execute" (default: "execute")
      approvalMode?: string,       // "ask" | "approveReads" | "approveEdits" | "approve" | "deny" | "dangerouslySkipPermissions"
      mcpServers?: McpServerConfig[],

      // Ent extensions
      maxBudgetUsd?: number,
      maxThinkingTokens?: number,
      enableFileCheckpointing?: boolean,
      sandbox?: SandboxConfig
    }
  }
}

// Response
{
  result: {
    protocolVersion: "1.0",
    agentInfo: {
      name: string,
      version: string
    },
    capabilities: AgentCapabilities
  }
}
```

### 5.2 `session/new` (ACP-compatible)

```typescript
// Request
{
  method: "session/new",
  params: {
    workDir: string,
    persona?: string,
    systemPrompt?: string | { type: "preset", preset: string, append?: string }
  }
}

// Response
{
  result: {
    sessionId: string,
    created: string  // ISO 8601
  }
}
```

### 5.3 `session/load` (ACP-compatible + extensions)

```typescript
// Request
{
  method: "session/load",
  params: {
    sessionId: string,
    fork?: boolean     // Create branch, preserve original
  }
}

// Response
{
  result: {
    sessionId: string,
    forkedFrom?: string,
    messageCount: number,
    lastActive: string
  }
}
```

### 5.4 `session/prompt` (ACP-compatible + extensions)

```typescript
// Request
{
  method: "session/prompt",
  params: {
    content: ContentBlock[],
    maxTurns?: number,

    // Ent extensions
    outputFormat?: {              // Structured output
      type: "json_schema",
      schema: JsonSchema
    }
  }
}

// Response (after turn completes)
{
  result: {
    turnId: string,             // Turn identifier (SHOULD be UUID)
    stopReason: "end_turn" | "max_tokens" | "max_turns" | "cancelled" | "budget_exceeded",
    content: ContentBlock[],
    usage: UsageInfo,

    // Ent extensions
    structuredOutput?: any,       // Parsed JSON if outputFormat specified
    cost?: {
      inputCostUsd: number,
      outputCostUsd: number,
      totalCostUsd: number
    }
  }
}
```

**Durable event guarantee**: A successful `session/prompt` response implies that corresponding durable events (`turn_start`, `message`, `tool_use`, `turn_end`) have been written and can be fetched via `ent/session/events` with stable ordering. The `turnId` in the response matches the `turnId` in those events.

### 5.5 `session/cancel` (ACP-compatible, notification)

Cancels the current operation.

```typescript
{
  method: "session/cancel"
}
```

**Cancellation semantics**:
- If a turn is running, it stops and returns with `stopReason: "cancelled"`.
- If a tool is `awaiting_permission`, the pending permission request is **invalidated**. The agent MUST emit a `tool_use` update with `status: "cancelled"` and discard the pending request from `ent/agent/status.pendingPermissions`. Clients MUST dismiss any approval UI for that `toolCallId`.
- If no turn is in progress, the notification is silently ignored.

### 5.6 `session/set_mode`

Set the agent's execution mode. This controls what tools are available.

**Note**: This is distinct from approval policy. To change whether tools require permission prompts, use `ent/session/configure` with `approvalMode`.

```typescript
// Request
{
  method: "session/set_mode",
  params: {
    mode: "plan" | "execute"
    // plan: Read, search, discuss, write plan files. No system-modifying tools.
    // execute: Full tool access (default)
  }
}

// Response
{
  result: {
    mode: string,
    previousMode: string
  }
}
```

### 5.7 `session/list` (ACP draft RFD)

```typescript
// Request
{
  method: "session/list",
  params: {
    workDir?: string
  }
}

// Response
{
  result: {
    sessions: [{
      sessionId: string,
      created: string,
      lastActive: string,
      messageCount: number,
      workDir: string
    }]
  }
}
```

---

## 6. Ent Extensions: Client → Agent

### 6.1 `ent/session/compact`

Compact conversation history to reduce context usage. State operation, not conversation.

```typescript
// Request
{
  method: "ent/session/compact",
  params: {
    strategy?: "summarize" | "truncate" | "selective",
    targetTokens?: number,      // Target context size
    preserveRecent?: number     // Keep last N messages verbatim
  }
}

// Response
{
  result: {
    previousTokens: number,
    currentTokens: number,
    messagesCompacted: number,
    summary?: string            // If strategy was summarize
  }
}
```

### 6.2 `ent/session/inject` (notification)

Inject context mid-turn. Not in ACP.

```typescript
{
  method: "ent/session/inject",
  params: {
    content: ContentBlock[],
    priority: "immediate" | "normal" | "deferred"
    // immediate: Cancel current LLM call, restart with context
    // normal: Add before next LLM call
    // deferred: Add after current turn
  }
}
```

### 6.3 `ent/session/configure`

Dynamic configuration changes. Covers Claude SDK's `setModel()`, `setMaxThinkingTokens()`, etc.

```typescript
// Request
{
  method: "ent/session/configure",
  params: {
    // Connection selection (where supported)
    connectionId?: string,     // Switch to a different configured connection
    modelId?: string,          // Model identifier (opaque string)

    // Runtime settings
    maxThinkingTokens?: number,
    maxBudgetUsd?: number,
    approvalMode?: "ask" | "approveReads" | "approveEdits" | "approve" | "deny" | "dangerouslySkipPermissions"
    // ask: Prompt for everything (default)
    // approveReads: Auto-approve reads/search, prompt for writes
    // approveEdits: Auto-approve reads + file edits, prompt for bash/dangerous
    // approve: Auto-approve all tool executions
    // deny: Reject all tool executions
    // dangerouslySkipPermissions: Skip permission system entirely
  }
}

// Response
{
  result: {
    applied: string[],  // List of settings that were changed
    config: object      // Current full config
  }
}
```

### 6.4 `ent/session/rewind`

File checkpointing. Covers Claude SDK's `rewindFiles()`.

```typescript
// Request
{
  method: "ent/session/rewind",
  params: {
    toEventSeq: number    // Rewind files to state at this event (from ent/session/events)
  }
}

// Response
{
  result: {
    filesRestored: string[],
    eventSeq: number      // The event we rewound to
  }
}
```

### 6.5 `ent/session/checkpoint`

Create explicit checkpoint.

```typescript
// Request
{
  method: "ent/session/checkpoint",
  params: {
    label?: string
  }
}

// Response
{
  result: {
    checkpointId: string,
    eventSeq: number,     // Current event sequence (use with ent/session/rewind)
    files: string[]
  }
}
```

### 6.6 `ent/job/list`

List background jobs (shells, subagents).

**Job identity requirements**: `jobId` SHOULD be generated using UUID/ULID/UUIDv7 or include a session-unique prefix (e.g., `${sessionId}:job_${n}`) to prevent collisions across session resume and restarts. Job IDs must be unique within the session lifetime.

```typescript
// Request
{
  method: "ent/job/list"
}

// Response
{
  result: {
    jobs: [{
      jobId: string,
      parentJobId?: string,        // If spawned by another job (nested subagent)
      type: "shell" | "subagent",
      status: "running" | "completed" | "failed" | "cancelled",
      description?: string,
      command?: string,
      startTime: string,
      parentToolUseId?: string
    }]
  }
}
```

### 6.7 `ent/job/output`

Get job output. Returns both raw output and a structured report suitable for parent context injection.

```typescript
// Request
{
  method: "ent/job/output",
  params: {
    jobId: string,
    block?: boolean,     // Wait for completion
    timeout?: number,    // Max wait ms

    // Output pagination (to prevent DOS on large job output)
    tailBytes?: number,  // Return only last N bytes of output (default: all)
    afterOffset?: number // Return output after this byte offset (for streaming)
  }
}

// Response
{
  result: {
    status: "running" | "completed" | "failed" | "cancelled",
    output: string,      // Raw output (may be truncated; see outputMeta)
    exitCode?: number,

    // Output metadata for pagination
    outputMeta?: {
      totalBytes: number,     // Total output size
      returnedOffset: number, // Byte offset of first returned byte
      returnedBytes: number,  // Size of returned output
      truncated: boolean      // True if output was truncated
    },

    // Structured report for parent context (compact)
    report?: {
      summary: string,           // Brief description of what happened
      artifacts?: string[],      // File paths or other outputs
      error?: string             // Error message if failed
    }
  }
}
```

**Report vs stream**: The supervisor sees the full job stream via `job_update` notifications. However, the parent agent SHOULD only incorporate `report` (not raw `output`) into its own LLM context to avoid context bloat. This preserves the "private subagent context" model—subagents can think verbosely without polluting the parent's context window.

**Sufficiency guarantee**: `ent/job/output` MUST be sufficient to recover a job's final state and report even if `job_update` streaming was set to `none` or updates were missed due to reconnection. Clients can rely on this method for authoritative job results.

### 6.8 `ent/job/kill`

Kill background job.

```typescript
// Request
{
  method: "ent/job/kill",
  params: {
    jobId: string
  }
}

// Response
{
  result: {
    success: boolean
  }
}
```

### 6.9 `ent/job/inject` (notification)

Inject context into a running job (subagent). Allows supervisor to provide additional information without making the job a full protocol peer.

```typescript
{
  method: "ent/job/inject",
  params: {
    jobId: string,
    content: ContentBlock[],
    priority: "immediate" | "normal" | "deferred"
    // immediate: Cancel current LLM call in job, restart with context
    // normal: Add before next LLM call in job
    // deferred: Add after current job turn
  }
}
```

**Note**: This is a notification (no response). The agent should forward the injection to the specified job if it's still running. If the job has completed, the injection is silently dropped.

### 6.10 `ent/agent/ping`

Lightweight health check. Use for liveness detection and supervisor heartbeats.

```typescript
// Request
{
  jsonrpc: "2.0",
  id: 1,
  method: "ent/agent/ping"
}

// Response
{
  jsonrpc: "2.0",
  id: 1,
  result: {
    ok: true,
    timestamp: string  // ISO 8601
  }
}
```

**Timeout guidance**: Clients SHOULD treat no response within 5 seconds as agent unresponsive. For detailed status (session info, pending permissions), use `ent/agent/status` instead.

### 6.11 `ent/agent/status`

Query agent status. Covers Claude SDK's `supportedModels()`, `mcpServerStatus()`, `accountInfo()`.

Also returns pending permission requests, enabling protocol clients (e.g., supervisors) to restore state after reconnection.

```typescript
// Request
{
  jsonrpc: "2.0",
  id: 1,
  method: "ent/agent/status"
}

// Response
{
  jsonrpc: "2.0",
  id: 1,
  result: {
    models: ModelInfo[],
    mcpServers: McpServerStatus[],

    currentSession?: {
      sessionId: string,
      messageCount: number,
      tokensUsed: number,
      costUsd: number,

      // Active connection/model selection
      providerId?: string,
      connectionId?: string,
      modelId?: string
    },

    // Current turn status (if turn in progress)
    currentTurn?: {
      turnId: string,
      status: "running" | "awaiting_permission" | "awaiting_input",
      startedAt: string  // ISO 8601
    },

    // Pending permission requests (for reconnection)
    pendingPermissions: PermissionRequest[],

    limits: {
      maxBudgetUsd?: number,
      budgetUsedUsd: number,
      maxTurns?: number
    }
  }
}
```

### 6.12 `ent/session/events`

Fetch session event history. Used by protocol clients (e.g., supervisors) that need to reconstruct conversation state after reconnection or process restart.

**Durable events only**: This method returns finalized events, not streaming deltas. For example, instead of individual `text_delta` updates, it returns complete `message` events with full text. This provides a stable history format suitable for persistence and replay.

```typescript
// Request
{
  jsonrpc: "2.0",
  id: 1,
  method: "ent/session/events",
  params: {
    afterEventSeq?: number,  // Return events after this global sequence number
    limit?: number,          // Max events to return (default 100)
    types?: string[]         // Filter by event type (optional)
  }
}

// Response
{
  jsonrpc: "2.0",
  id: 1,
  result: {
    events: [{
      eventSeq: number,     // Global stable sequence number (never resets)
      timestamp: string,    // ISO 8601
      turnId?: string,      // Which turn generated this event
      turnSeq?: number,     // Sequence within that turn (for correlation with live updates)
      type: string,         // Durable event type (see below)
      data: object          // Event-specific data
    }],
    hasMore: boolean        // More events available
  }
}
```

**Durable event types** (distinct from streaming `session/update` types):
- `prompt`: User prompt submitted (full content)
- `message`: Agent message (full text, not deltas)
- `tool_use`: Tool execution (complete with result)
- `error`: Error occurred
- `turn_start`: Turn began
- `turn_end`: Turn completed (with stop reason)

Events are ordered by `eventSeq` and can be paginated. The `eventSeq` is globally stable across reconnections and never resets.

### 6.13 Provider and Connection Model

This section defines how agents expose provider families and configured connections.

**Terminology** (ACP-compatible field names):

| Field | Description | Example |
|-------|-------------|---------|
| `providerId` | Provider family/runtime identifier (opaque string) | `"anthropic"`, `"openai"`, `"openai-compatible"`, `"claude-code-wrapper"` |
| `modelId` | Model identifier within a provider (opaque string) | `"claude-sonnet-4-20250514"`, `"gpt-4o"` |
| `connectionId` | Configured connection to a provider: endpoint + settings + credentials | `"conn_anthropic_prod"`, `"conn_openai_dev"` |

**Invariants**:
- A `connectionId` is always paired with exactly one `providerId`. This pairing MUST NOT change.
- Credentials are mutable: agents MUST support updating credentials for an existing `connectionId` (credential rotation) without changing the connection's identity.
- Methods operating on a specific connection take `connectionId` only (not both `providerId` and `connectionId`), except when creating a new connection.
- Sessions can switch active `connectionId` via `ent/session/configure`.

**Wrapper guidance**: Agents wrapping single-provider runtimes (e.g., Claude Code, Codex) should expose one `providerId`, one `connectionId`, and set `ProviderInfo.supportsConnections: false`. Credentials may use `{ kind: "ready" }` for ambient auth or implement device_code/browser flows.

### 6.14 `ent/providers/list`

List available provider families supported by this agent runtime.

```typescript
// Request
{
  method: "ent/providers/list"
}

// Response
{
  result: {
    providers: ProviderInfo[]
  }
}
```

**Notes**:
- Wrappers (Claude Code, Codex) typically return exactly one provider.
- Lace-like agents may return multiple providers.
- Clients MUST feature-detect via `ent/providers` capability before calling.

### 6.15 `ent/connections/list`

List configured connections, optionally filtered by provider.

```typescript
// Request
{
  method: "ent/connections/list",
  params: {
    providerId?: string   // Optional filter; omit for all connections
  }
}

// Response
{
  result: {
    connections: ConnectionInfo[]
  }
}
```

### 6.16 `ent/connections/upsert`

Create or update a connection. When creating, `providerId` is required. When updating, only `connectionId` is needed.

```typescript
// Request
{
  method: "ent/connections/upsert",
  params: {
    providerId?: string,       // Required when creating new connection
    connection: {
      connectionId?: string,   // Omit to create new; provide to update existing
      name: string,
      config: object           // Provider-specific non-secret configuration (endpoint, baseURL, etc.)
    }
  }
}

// Response
{
  result: {
    connectionId: string,
    providerId: string,
    created: boolean
  }
}
```

**Security requirement**: The `config` object MUST NOT contain credentials. Use `ent/connections/credentials/*` methods to manage credentials separately.

### 6.17 `ent/connections/delete`

Delete a configured connection.

```typescript
// Request
{
  method: "ent/connections/delete",
  params: {
    connectionId: string
  }
}

// Response
{
  result: { ok: true }
}
```

### 6.18 `ent/connections/test`

Test connectivity for a connection.

```typescript
// Request
{
  method: "ent/connections/test",
  params: {
    connectionId: string,
    modelId?: string     // Optional model to test against
  }
}

// Response
{
  result: {
    ok: boolean,
    error?: string,
    latencyMs?: number
  }
}
```

### 6.19 `ent/connections/credentials/status`

Get credential status for a connection.

```typescript
// Request
{
  method: "ent/connections/credentials/status",
  params: {
    connectionId: string
  }
}

// Response
{
  result: {
    connectionId: string,
    state: "ready" | "missing" | "expired" | "invalid" | "unknown",
    accountLabel?: string,   // e.g., email/org, if available
    expiresAt?: string       // ISO 8601, if known
  }
}
```

### 6.20 `ent/connections/credentials/start`

Begin an interactive credential/login flow for a connection. Supports credential rotation for existing connections.

```typescript
// Request
{
  method: "ent/connections/credentials/start",
  params: {
    connectionId: string,
    method?: "api_key" | "device_code" | "browser" | "token"
  }
}

// Response
{
  result:
    | {
        kind: "needs_input",
        fields: Array<{ name: string; label?: string; secret: boolean; hint?: string }>
      }
    | {
        kind: "device_code",
        verificationUri: string,
        userCode: string,
        expiresAt: string   // ISO 8601
      }
    | { kind: "browser", url: string }
    | { kind: "ready" }
}
```

**Behavior**:
- If already authenticated with valid credentials, return `{ kind: "ready" }`.
- Implementations MAY ignore `method` and choose the best available flow.
- This method supports credential rotation: calling it on a connection with existing credentials initiates a new credential flow that replaces the old credentials on successful completion.

### 6.21 `ent/connections/credentials/submit`

Submit credentials or flow completion information.

```typescript
// Request
{
  method: "ent/connections/credentials/submit",
  params: {
    connectionId: string,
    values: Record<string, string>
  }
}

// Response
{
  result: { ok: true } | { ok: false; error: string }
}
```

**Security requirement**: Agents MUST NOT emit secrets in `session/update` streams, `ent/session/events`, or error messages. Secrets MUST be redacted.

### 6.22 `ent/connections/credentials/clear` (optional)

Clear credentials for a connection without deleting the connection itself.

```typescript
// Request
{
  method: "ent/connections/credentials/clear",
  params: {
    connectionId: string
  }
}

// Response
{
  result: { ok: true }
}
```

### 6.23 `ent/models/list`

List available models for a connection. Model catalogs are connection-scoped because available models can vary by endpoint and credentials (especially for OpenAI-compatible providers).

```typescript
// Request
{
  method: "ent/models/list",
  params: {
    connectionId: string
  }
}

// Response
{
  result: {
    providerId: string,
    connectionId: string,
    models: ModelInfo[]
  }
}
```

### 6.24 `ent/models/refresh` (optional)

Refresh model catalog from upstream provider.

```typescript
// Request
{
  method: "ent/models/refresh",
  params: {
    connectionId: string
  }
}

// Response
{
  result: {
    connectionId: string,
    refreshedAt: string,   // ISO 8601
    ok: boolean,
    error?: string
  }
}
```

**Note**: Only available if `ent/providers.catalogRefresh` is `true`.

---

## 7. Methods: Agent → Client

### 7.1 `session/update` (notification)

Stream updates during turn processing. All updates include correlation IDs for ordering and disambiguation.

**ACP note**: This method shares the same name and notification pattern as ACP's `session/update`, but uses Ent-native update types (e.g., `text_delta` instead of ACP's `agent_message_chunk`, `tool_use` instead of `tool_call`). An adapter layer would be needed for wire compatibility with ACP clients.

**Common fields** (included in all session/update notifications):
```typescript
{
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: string,      // Session this update belongs to
    streamSeq: number,      // Global sequence across all updates (never resets)

    // Turn context (optional for job updates that outlive turns)
    turnId?: string,        // Prompt turn that generated this update
    turnSeq?: number,       // Sequence within turn (resets each turn)

    // Job context (for background job updates)
    jobId?: string,         // Background job ID (if from a job)

    type: string,           // Update type (see below)
    // ... type-specific fields
  }
}
```

**Ordering**: Use `streamSeq` for global ordering of all updates. Use `turnId` + `turnSeq` for turn-scoped ordering. Job updates may have `jobId` without `turnId` if they outlive the originating turn.

**Sequence number ownership and persistence**:
- `streamSeq`: Assigned by the **emitting agent process** at time of emission. For `job_update`, the parent agent assigns the sequence (not the subagent). MUST be monotonic for the lifetime of the process+session. Implementations SHOULD persist the last `streamSeq` checkpoint to survive session resume, but are NOT required to persist every streaming update—only the counter value.
- `eventSeq`: Assigned by the agent when writing durable events. MUST be persisted in the session log (JSONL or equivalent). Used for `ent/session/events` pagination.
- `turnSeq`: Assigned per-turn, resets each turn. Does not require cross-restart persistence.

**Update types:**

```typescript
// Text chunk
{ type: "text_delta", text: string }

// Tool execution
{
  type: "tool_use",
  toolCallId: string,
  name: string,
  kind?: "read" | "edit" | "delete" | "search" | "execute" | "think" | "fetch" | "other",
  input: object,
  status: "pending" | "awaiting_permission" | "running" | "completed" | "failed" | "denied" | "timeout" | "cancelled",
  result?: ToolResult       // Present when status is terminal (completed/failed/denied/timeout/cancelled)
}

// Usage
{
  type: "usage",
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
  thinkingTokens?: number,
  costUsd?: number
}

// Thinking (extended thinking models)
{ type: "thinking", text: string }

// Plan
{
  type: "plan",
  tasks: [{
    taskId: string,
    content: string,
    status: "pending" | "in_progress" | "completed",
    priority?: number
  }]
}

// Mode change
{ type: "mode_change", mode: string, previousMode: string }

// Context injected
{ type: "context_injected", priority: string, messageCount: number }

// Job lifecycle (top-level only, not valid as inner update types)
{ type: "job_started", jobId: string, parentJobId?: string, jobType: "shell" | "subagent", description?: string }
{ type: "job_finished", jobId: string, parentJobId?: string, exitCode?: number, outcome: "completed" | "failed" | "cancelled" }

// Job-scoped update wrapper (reuses all update types above)
{
  type: "job_update",
  jobId: string,
  parentJobId?: string,                        // If this job was spawned by another job
  jobType?: "shell" | "subagent",
  channel?: "stdout" | "stderr" | "internal",  // Optional output channel hint
  update: SessionUpdateInner  // Any of the update types above (text_delta, tool_use, etc.)
}
```

**Job updates**: The `job_update` wrapper allows job/subagent activity to stream through the same channel using the same update type vocabulary. The inner `update` field contains any of the standard update types (`text_delta`, `tool_use`, `usage`, etc.). This lets client renderers reuse one codepath for both top-level and job updates.

**Recursion restriction**: The following types MUST NOT appear as the inner `update.type`: `job_update`, `job_started`, `job_finished`. These are top-level lifecycle events only.

**Nested jobs**: When a subagent spawns its own subagents, the parent agent MUST forward all descendant jobs as flattened top-level `job_started`/`job_update`/`job_finished` events. Use `parentJobId` to represent the hierarchy. This avoids recursive nesting while still representing arbitrarily deep job trees.

**Backpressure guidance**: Implementations MAY coalesce multiple `text_delta` updates into larger chunks, especially within `job_update`. For verbose jobs (test suites, builds), aggressive coalescing prevents UI lockups and transport buffer growth.

**Job streaming capability** (`ent/jobStreaming`): Controls how much job output the agent sends:
- `full`: Forward all `job_update` deltas as they occur (default)
- `coalesced`: Coalesce `text_delta` updates into larger chunks; suppress high-frequency updates
- `none`: Only send `job_started`, `job_finished`, and final report via `ent/job/output`; no streaming deltas

### 7.2 `session/request_permission` (ACP-compatible)

Agent requests permission to execute a tool. This is a **request** (has `id`), not a notification.

**Pause semantics**:
- After sending this request, the agent MUST NOT execute the tool until it receives a response (or `session/cancel`, or timeout).
- If `jobId` is present, the agent MUST pause execution of **that job only** until decision is received. The agent MAY continue other unrelated work (including the parent turn) unless it is logically awaiting the job's completion.
- The agent should emit a `tool_use` update with `status: "awaiting_permission"` to indicate the pause state.

```typescript
// Request (Agent → Client)
{
  jsonrpc: "2.0",
  id: "a_1",              // Agent-generated ID (negative or "a_" prefixed)
  method: "session/request_permission",
  params: {
    // Correlation fields
    sessionId: string,    // Session this request belongs to
    turnId: string,       // Turn that triggered the tool call (SHOULD be UUID)
    turnSeq: number,      // Sequence within turn (matches tool_use update)
    jobId?: string,       // If present, permission is for a job's tool use

    // Tool identification
    toolCallId: string,   // MUST be globally unique (see below)
    tool: string,
    kind?: string,        // Tool kind
    resource: string,     // What's being accessed
    options: [{
      optionId: string,   // "allow", "deny", "allow_session", "allow_always"
      label: string
    }]
  }
}

// Response (Client → Agent)
{
  jsonrpc: "2.0",
  id: "a_1",              // Must match request ID
  result: {
    decision: string,     // Selected option id
    updatedInput?: object // Modified tool input (optional)
  }
}
```

**Global uniqueness requirements**:
- `toolCallId` MUST be globally unique within the session **across the parent agent and all jobs/subagents**. This is critical for permission deduplication and routing.
- Recommended: Use UUID/ULID/UUIDv7 for `toolCallId`. If using counters, namespace with jobId (e.g., `${jobId}:${n}`) and ensure jobId uniqueness.
- `turnId` SHOULD be UUID/ULID/UUIDv7 to prevent correlation collisions.

**Idempotency**: If the client sends duplicate responses for the same `toolCallId`, the agent ignores all but the first. This prevents race conditions from network retries or UI double-clicks.

**Durability**: The agent MUST persist pending permission requests in its own session log. After an agent restart, it reconstructs pending requests from this log and exposes them via `ent/agent/status.pendingPermissions`. The `ent/session/events` API returns only finalized events (completed tool uses with results), not pending permission requests—use `ent/agent/status` for current pending state.

---

## 8. Content Types

### 8.1 ContentBlock (ACP-compatible)

```typescript
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string }  // base64
  | { type: "tool_use"; toolUseId: string; name: string; input: object }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
```

**toolUseId vs toolCallId**: ContentBlock uses `toolUseId` for Anthropic API compatibility. This is the **same identifier** as `toolCallId` used in `session/update` and `session/request_permission`. Implementations MUST treat them as equivalent—when correlating tool executions across streaming updates, permission requests, and content blocks, `toolUseId === toolCallId`.

---

## 10. Error Codes

### 10.1 JSON-RPC Standard

| Code | Name |
|------|------|
| -32700 | ParseError |
| -32600 | InvalidRequest |
| -32601 | MethodNotFound |
| -32602 | InvalidParams |
| -32603 | InternalError |

### 10.2 ACP Standard

| Code | Name |
|------|------|
| 1 | SessionNotFound |
| 2 | SessionBusy |
| 3 | PermissionDenied |
| 4 | ToolNotFound |
| 5 | MaxTurnsExceeded |
| 6 | Cancelled |

### 10.3 Ent Extensions

| Code | Name |
|------|------|
| 7 | ProviderError |
| 8 | JobNotFound |
| 9 | NotInitialized |
| 10 | AlreadyInitialized |
| 11 | BudgetExceeded |
| 12 | CheckpointNotFound |
| 13 | StructuredOutputInvalid |
| 14 | ConnectionNotFound |

### 10.4 Error Reporting Contract

Errors fall into distinct categories for client handling:

| Category | Error Codes | Meaning | Client Action |
|----------|-------------|---------|---------------|
| **Agent internal** | -32603, 9, 10 | Agent process failure | Restart agent |
| **Provider** | 7 | LLM API error (rate limit, auth, etc.) | Retry or escalate |
| **Tool** | 4, `tool_use.status=failed` | Tool execution failed | Show to user |
| **Session** | 1, 2, 5, 6, 11, 12 | Session state issue | Handle per code |
| **Protocol** | -32700 to -32600 | Malformed request | Fix client |

Error responses SHOULD include `data.category` to disambiguate:
```typescript
{
  error: {
    code: 7,
    message: "Rate limit exceeded",
    data: {
      category: "provider",
      retryAfter?: number  // seconds
    }
  }
}
```

---

## 11. Configuration Types

### 11.1 McpServerConfig

```typescript
interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "sse" | "http";
}
```

### 11.2 SandboxConfig

```typescript
interface SandboxConfig {
  enabled: boolean;
  network?: {
    allowLocalBinding?: boolean;
    allowedHosts?: string[];
  };
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
}
```

### 11.3 ModelInfo

```typescript
interface ModelInfo {
  modelId: string;
  name: string;
  providerId: string;
  contextWindow: number;
  maxOutput: number;
  supportsThinking?: boolean;
  supportsImages?: boolean;
}
```

### 11.4 ToolInfo

```typescript
interface ToolInfo {
  name: string;                // MUST be stable and unique within agent
  description: string;
  kind: "read" | "edit" | "delete" | "search" | "execute" | "think" | "fetch" | "other";
  inputSchema: JsonSchema;     // MUST be present (required for approval policies)
  requiresPermission?: boolean;
}
```

**Normative requirements**: `name` MUST be stable across sessions and unique within the agent's tool set. `inputSchema` MUST be present and follow JSON Schema (draft-07+). Clients MAY use `name` for approval policies, UI rendering, and tool-specific logic.

### 11.5 JsonSchema

```typescript
// Standard JSON Schema (draft-07 or later)
interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: any[];
  const?: any;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  // ... other standard JSON Schema keywords
}
```

### 11.6 UsageInfo

```typescript
interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}
```

### 11.7 ToolResult

```typescript
// Tool results support structured content, not just strings
interface ToolResult {
  outcome: "completed" | "failed" | "denied" | "timeout" | "cancelled";
  content: ToolResultContent[];
  meta?: Record<string, any>;  // Tool-specific metadata
}

type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "json"; data: any }
  | { type: "image"; data: string; mediaType: string }
  | { type: "error"; message: string; code?: string };
```

**Lifecycle vs outcome alignment**:
- `tool_use.status` tracks lifecycle: `pending` → `awaiting_permission` → `running` → terminal
- Terminal states are: `completed` | `failed` | `denied` | `timeout` | `cancelled`
- `ToolResult.outcome` MUST equal the terminal `tool_use.status`
- Example: a tool that errors has `status: "failed"` and `outcome: "failed"`; a successful tool has `status: "completed"` and `outcome: "completed"`

### 11.8 McpServerStatus

```typescript
interface McpServerStatus {
  name: string;
  status: "connected" | "connecting" | "disconnected" | "error";
  error?: string;
  tools?: string[];       // Available tools from this server
  lastConnected?: string; // ISO 8601
}
```

### 11.9 PermissionRequest

```typescript
// Pending permission request (for reconnection scenarios)
interface PermissionRequest {
  requestId: string;       // JSON-RPC request ID
  toolCallId: string;      // MUST be globally unique across session + jobs
  sessionId: string;
  turnId: string;          // SHOULD be UUID
  turnSeq: number;
  jobId?: string;          // If present, permission is for a job's tool use
  tool: string;
  kind?: string;
  resource: string;
  options: { optionId: string; label: string }[];
  requestedAt: string;     // ISO 8601
}
```

### 11.10 ProviderInfo

```typescript
// Provider family descriptor (returned by ent/providers/list)
interface ProviderInfo {
  providerId: string;               // Provider identifier (opaque)
  displayName: string;
  supportsConnections: boolean;     // Can create multiple connections
  supportsCatalogRefresh?: boolean; // Connections can call ent/models/refresh
}
```

### 11.11 ConnectionInfo

```typescript
// Configured provider connection (returned by ent/connections/list)
interface ConnectionInfo {
  connectionId: string;
  providerId: string;                // Parent provider (immutable)
  name: string;
  isDefault?: boolean;
  createdAt?: string;                // ISO 8601
  lastUsedAt?: string;               // ISO 8601

  // Credential status (inline for convenience; also queryable via credentials/status)
  credentialState?: "ready" | "missing" | "expired" | "invalid" | "unknown";
  accountLabel?: string;             // e.g., email/org, if available
}
```

---

## 12. Compatibility Summary

| Method | ACP Status | Notes |
|--------|------------|-------|
| `initialize` | ✅ Compatible | Extended params |
| `session/new` | ✅ Compatible | |
| `session/load` | ✅ Compatible | |
| `session/prompt` | ✅ Compatible | Extended params |
| `session/cancel` | ✅ Compatible | |
| `session/set_mode` | 🔸 Shape compatible | Ent-native mode values |
| `session/list` | ✅ ACP Draft | |
| `session/update` | 🔸 Shape compatible | Ent-native type names |
| `session/request_permission` | ✅ Compatible | |
| `ent/session/compact` | 🔧 Extension | |
| `ent/session/inject` | 🔧 Extension | Propose to ACP |
| `ent/session/configure` | 🔧 Extension | |
| `ent/session/rewind` | 🔧 Extension | |
| `ent/session/checkpoint` | 🔧 Extension | |
| `ent/session/events` | 🔧 Extension | History replay |
| `ent/job/*` | 🔧 Extension | Propose to ACP |
| `ent/agent/ping` | 🔧 Extension | Health check |
| `ent/agent/status` | 🔧 Extension | |
| `ent/providers/list` | 🔧 Extension | Provider discovery |
| `ent/connections/*` | 🔧 Extension | Connection management |
| `ent/connections/credentials/*` | 🔧 Extension | Connection-scoped auth |
| `ent/models/*` | 🔧 Extension | Connection-scoped catalog |
| `fs/*` | ❌ Not implemented | Agent-centric |
| `terminal/*` | ❌ Not implemented | Agent-centric |

---

## 13. Claude Agent SDK Feature Coverage

| SDK Feature | Protocol Support |
|-------------|-----------------|
| Subprocess execution | ✅ Architecture |
| JSON-over-stdio | ✅ Transport |
| Streaming messages | ✅ `session/update` |
| Session persist/resume | ✅ `session/new`, `session/load` |
| Session forking | ✅ `session/load` with fork |
| Subagents | ✅ `ent/job/*` + updates |
| Tool whitelist/blacklist | ✅ `initialize` config |
| Execution modes | ✅ `session/set_mode` (plan/execute) |
| Approval modes | ✅ `ent/session/configure` (ask/approveReads/approveEdits/approve/deny/skip) |
| Permission callbacks | ✅ `session/request_permission` |
| MCP integration | ✅ `initialize` config |
| Context compaction | ✅ `ent/session/compact` |
| File checkpointing | ✅ `ent/session/checkpoint`, `rewind` |
| Interrupt/cancel | ✅ `session/cancel` |
| Context injection | ✅ `ent/session/inject` |
| Partial streaming | ✅ `session/update` |
| Structured output | ✅ `session/prompt` outputFormat |
| Budget control | ✅ `initialize` + error code |
| Model switching | ✅ `ent/session/configure` |
| Thinking tokens | ✅ `ent/session/configure` |
| Sandbox config | ✅ `initialize` config |
| Session history | ✅ `ent/session/events` |
| Provider discovery | ✅ `ent/providers/list` |
| Connection management | ✅ `ent/connections/*` |
| Authentication | ✅ `ent/connections/credentials/*` |
| Model catalog | ✅ `ent/models/*` (connection-scoped) |

---

## 14. Command Routing Architecture

This section describes how user commands (including slash commands) are routed between client and agent.

### 14.1 Command Categories

Commands fall into three categories with different routing behavior:

| Category | Examples | Routing | Protocol Method |
|----------|----------|---------|-----------------|
| **UI-only** | `/clear`, `/quit`, `/settings` | Client handles locally | None |
| **State operations** | `/compact`, `/checkpoint`, `/rewind` | Client calls protocol method | `ent/session/*` |
| **Conversation** | `/commit`, `/review-pr`, natural language | Client sends as prompt | `session/prompt` |

### 14.2 Distinguishing State Operations from Conversation

The key distinction: **does this produce conversation content, or modify session state?**

- **State operations**: Modify session state, return structured data, don't become part of conversation history. Examples: compacting history, creating checkpoints, switching models.

- **Conversation actions**: Agent talks through the action, produces text/tool output that becomes part of history. Examples: creating a commit, reviewing code, answering questions.

### 14.3 Capability Advertisement

The agent advertises what it supports:

```typescript
{
  // State operations - client checks before calling methods
  operations: {
    compact: true,      // → ent/session/compact
    checkpoint: true,   // → ent/session/checkpoint
    rewind: true,       // → ent/session/rewind
    configure: true     // → ent/session/configure
  },

  // Conversation commands - for autocomplete/help
  slashCommands: [
    { name: "commit", description: "Create a git commit", inputHint: "-m <message>" },
    { name: "review-pr", description: "Review a pull request", inputHint: "<number>" }
  ]
}
```

### 14.4 Client Routing Logic

```typescript
function routeCommand(input: string): void {
  const [cmd, ...args] = parseSlashCommand(input);

  // 1. Client-only (hardcoded set)
  if (["clear", "quit", "settings", "help"].includes(cmd)) {
    handleLocally(cmd, args);
    return;
  }

  // 2. State operations (check capabilities, call method)
  if (capabilities.operations?.[cmd]) {
    const result = await callMethod(`ent/session/${cmd}`, parseArgs(args));
    displayStructuredResult(result);
    return;
  }

  // 3. Check if it's a known slash command
  if (capabilities.slashCommands?.some(c => c.name === cmd)) {
    await sessionPrompt(input);  // send original text
    return;
  }

  // 4. Unknown - send as prompt, let agent handle
  await sessionPrompt(input);
}
```

### 14.5 Benefits of This Design

1. **State operations are methods** - Structured request/response, not conversation pollution
2. **Conversation commands are prompts** - Agent handles naturally, highly extensible
3. **Clear separation** - Client knows what goes where
4. **Extensibility where it matters** - New skills = add to slashCommands, no protocol change
5. **Stability where it matters** - State operations are well-defined protocol methods
