# About the Ent Protocol

Design decisions, rationale, and context for the Ent protocol specification.

---

## 1. ACP RFD Alignment

Ent is actively aligned with the [Agent Client Protocol](https://agentclientprotocol.com) RFD (Request for Discussion) process. The following features are implemented per ACP draft RFDs:

### ACP Alignments

| Feature | ACP RFD | Ent Implementation |
|---------|---------|-------------------|
| **session/list** | ACP Draft RFD | Field renames: `workDir` → `cwd`, `lastActive` → `updatedAt`. Added pagination (`cursor`, `nextCursor`) and metadata (`title`, `_meta`). |
| **session/fork** | ACP Draft RFD | Dedicated method for session forking with optional `cwd` and `mcpServers` overrides. |
| **$/cancel_request** | ACP Standard | Per-request cancellation with `-32800` error code. Replaces earlier `session/cancel` approach. |

### Intentional Divergences

**camelCase vs snake_case**: The Ent protocol uses `camelCase` for field names (`sessionId`, `toolCallId`) to align with JSON/JavaScript conventions, while some ACP RFDs use `snake_case`. This is an intentional design choice to match the broader protocol naming (inherited from Anthropic API conventions). Adapters converting between Ent and ACP can normalize this at transport boundaries.

**Event type names**: `session/update` notification uses Ent-native event type names (`text_delta`, `tool_use`) rather than ACP names. This allows cleaner client-side event handling and avoids translation layers. An adapter layer would be needed for ACP-compatible clients.

---

## 2. Why Not Just Use ACP?

We evaluated the [Agent Client Protocol](https://agentclientprotocol.com) (ACP) as a potential standard. See [acp-evaluation.md](../research/acp-evaluation.md) for the full analysis.

**Summary**: ACP is well-designed but targets a different use case (IDE integration). Key differences:

| Aspect | ACP | Ent |
|--------|-----|-----|
| Primary client | Code editors (Zed, VS Code) | CLI |
| FS/terminal access | Client-mediated | Agent-direct |
| Focus | IDE integration | Standalone agent |

**Decision**: Use our own protocol, but design for ~80% ACP compatibility. This lets us potentially integrate with ACP clients in the future while optimizing for our CLI use case now.

---

## 2. Agent-Centric vs Client-Centric

### The Fundamental Choice

ACP is **client-centric**: the client (editor) owns filesystem and terminal access. When the agent needs to read a file, it sends `fs/read_text_file` to the client.

Ent is **agent-centric**: the agent has direct access. It reads files, runs commands, and reports what it did via `session/update`.

### Why Agent-Centric?

1. **CLI context**: Our primary client is a terminal. The agent runs locally with the same permissions as the user.

2. **Performance**: No round-trip for every file read or command execution.

3. **Simplicity**: Agent can use standard filesystem APIs directly.

4. **Sandboxing is orthogonal**: We can still sandbox the agent process itself; we just don't mediate through the client.

### ACP Compatibility

We achieve compatibility by declaring `fileSystem: false` and `terminal: false` in client capabilities. This tells ACP-aware agents "don't ask me for FS/terminal - handle it yourself."

---

## 3. Extension Naming

All Ent-specific methods use the `ent/` prefix:
- `ent/session/compact`
- `ent/session/inject`
- `ent/job/list`
- `ent/session/configure` supports **env** to let the supervisor push per-session
  environment variables without touching agent config on disk.
- Provider management extensions (see below) add catalog refresh and model enable/disable flows.

This keeps the namespace clean and makes it obvious which parts are standard ACP vs our extensions.

### UI / Agent Boundary (very important)

In Lace, the **agent owns its on-disk state** under `~/.lace/**` (or the configured lace dir). UIs (web, TUI) MUST treat this as an implementation detail and MUST NOT read or write it directly.

- Web and TUI should only interact with providers/models/connections/credentials through Ent methods such as `ent/providers/catalog`, `ent/connections/*`, and `ent/models/*`.
- Web may have its own datastore for web-only concepts (projects, settings) outside the protocol.

---

## 4. Process and Session Model

**One process = one session.** Each agent process handles exactly one active session.

### Why This Constraint?

1. **Clean isolation**: Each process has its own conversation state, tool permissions, and resource handles. No shared state to corrupt.

2. **Simple supervision**: The client spawns a process, communicates with it, and knows the process IS the session.

3. **Predictable lifecycle**: Process exit = session ends. No orphaned sessions.

### What About Multi-Session?

To work with multiple sessions concurrently, spawn multiple agent processes. The supervisor (client) manages the process pool.

`session/list` queries available sessions on disk but doesn't load them. To work with a different session, spawn a new process.

### Session-level Environment

- **env**: Use `ent/session/configure` to set a per-session map of string env vars.
  The agent merges these on top of its base env for tool execution and subprocesses.

---

## 5. Correlation and Ordering

### The Problem

When streaming updates arrive (`session/update` notifications), the client needs to know:
- Which session they belong to
- Which prompt turn generated them
- How to order them

This becomes critical with:
- Background job updates + live turn updates
- Retries or reconnections
- Multiple subagents running in parallel

### The Solution: Three Sequence Numbers

**`streamSeq`** (in `session/update`): Global sequence across ALL streaming updates. Never resets. Use for total ordering of everything—turns, jobs, subagents.

**`turnSeq`** (in `session/update`): Monotonically increasing within a single turn. Resets to 0 for each new prompt. Optional for job updates that outlive turns.

**`eventSeq`** (in `ent/session/events`): Globally monotonic across the entire session. Never resets. Used for durable history pagination.

Every `session/update` notification includes:
- `sessionId`: Which session
- `streamSeq`: Global sequence (for total ordering)
- `turnId?`: Prompt turn (optional for long-running jobs)
- `turnSeq?`: Sequence within turn (optional for long-running jobs)
- `jobId?`: Background job ID (if from a job)

Every durable event in `ent/session/events` includes:
- `eventSeq`: Global sequence (for history pagination)
- `turnId`: Which turn generated the event
- `turnSeq`: Sequence within turn (for correlation)

This allows clients to:
- Order ALL updates globally (streamSeq)
- Order updates within a turn (turnSeq)
- Handle job updates that outlive turns (jobId without turnId)
- Paginate history with stable cursors (afterEventSeq)

---

## 6. Idempotency and Retries

### Requests

Retrying a request with the same `id` is safe. The recipient caches responses and returns the cached result for duplicate `id`s.

**Caching bounds**: To prevent unbounded memory growth, response caches are limited:
- Up to 1000 recent request IDs per direction
- LRU eviction policy
- Cache cleared when session ends

### Permission Responses

`toolCallId` is globally unique within a session **across the parent agent and all jobs/subagents**. If the client sends duplicate responses for the same `toolCallId`, the agent ignores all but the first. Recommended: use UUID/ULID for `toolCallId` to prevent collisions.

This prevents race conditions from:
- Network retries
- UI double-clicks
- Reconnection replays

### Notifications

Fire-and-forget. Duplicates may cause redundant processing but should not corrupt state.

---

## 7. Session History and Reconnection

### The Problem

When a protocol client needs to sync state—whether after a transport disconnect, process restart, or simply joining an in-progress session—it needs to reconstruct conversation history and current state.

**Architecture note**: In systems like Lace, the Ent protocol client is typically a long-running supervisor process, not the browser. A browser refresh reconnects to the supervisor via a separate transport (e.g., WebSocket); it doesn't imply an Ent transport reconnect. The APIs below are for the supervisor-to-agent connection.

### The Solution

Two methods work together for state reconstruction:

**`ent/session/events`** fetches session event history:
- Paged (with `afterEventSeq` and `limit`)
- Filterable by event type
- Returns stable `eventSeq` numbers for ordering (never reset)

**Durable events only**: The history API returns finalized events, not streaming deltas. For example, complete `message` events instead of `text_delta` sequences. This provides a stable format suitable for persistence.

**`ent/agent/status`** returns current state including:
- `currentTurn`: Status of any in-progress turn
- `pendingPermissions`: Array of pending permission requests

This combination allows:
- Supervisors to reconstruct timeline after restart
- Restore pending permission state after reconnect
- Resume interaction with in-progress turns
- Clients to sync state after network issues

---

## 8. Command Routing Architecture

### The Problem

Users type commands like `/compact`, `/commit`, `/clear`. How should these be handled?

ACP's answer: Everything goes through `session/prompt`. The agent parses the slash command from the text.

Problems with this:
- `/compact` becomes part of conversation history (weird)
- No structured parameters or response
- Mixes operational commands with conversation

### The Solution: Three Categories

| Category | Examples | Routing |
|----------|----------|---------|
| **UI-only** | `/clear`, `/quit` | Client handles locally |
| **State operations** | `/compact`, `/checkpoint` | Protocol method with structured params |
| **Conversation** | `/commit`, `/review-pr` | Send via `session/prompt` |

### Key Insight

**State operations** modify session state and return structured data. They shouldn't become conversation.

**Conversation commands** are just prompts with syntactic sugar. The agent talks through them.

### Capability Advertisement

```typescript
{
  operations: {
    compact: true,      // client can call ent/session/compact
    checkpoint: true,
  },
  slashCommands: [
    { name: "commit", description: "Create a git commit" },
  ]
}
```

The client uses `operations` to know which protocol methods exist, and `slashCommands` for autocomplete/help on conversation commands.

---

## 9. Context Injection

### The Feature

`ent/session/inject` allows the client to inject context mid-turn. Example: user pastes additional info while the agent is thinking.

### Why It's Not in ACP

ACP is designed for editors where the user waits for the agent to finish. Our CLI supports more interactive patterns.

### Priority Levels

- `immediate`: Cancel current LLM call, restart with new context
- `normal`: Add before next LLM call in the turn
- `deferred`: Add after current turn completes

---

## 10. Background Jobs and Subagents

### The Feature

`ent/job/*` methods manage background shells and subagents. The agent can spawn long-running processes and check on them later.

### Why It's Not in ACP

ACP's terminal model is synchronous: create terminal, wait for output, release. Our model supports true background execution with:
- Non-blocking spawn
- Output polling
- Explicit kill

This is essential for running test suites, builds, and other long operations while continuing the conversation.

### Subagent Ownership

When an agent uses the Task tool to spawn subagents:
- The **agent process** spawns and owns the subagent process
- The **supervisor/client** sees subagents via `ent/job/*` methods
- Job IDs are agent-generated (`job_agent_1`, `job_shell_1`)
- The supervisor does NOT spawn subagent processes directly

This keeps the "one process = one conversation stream" model clean: the supervisor manages top-level agent processes, and each agent manages its own subagents internally.

### Design Choice: Subagents as Jobs

This "subagents as jobs" model means subagents are not first-class protocol peers—you cannot send `session/prompt` directly to a subagent. This is intentional for v1:

1. **Simplicity**: The protocol stays simple with one conversation stream per process
2. **Common case**: Most subagents run autonomously and return results
3. **Clean ownership**: The parent agent manages subagent lifecycle

**Future extensibility**: If interactive multi-agent collaboration becomes a requirement, future protocol versions could add "subagent = full protocol peer" where the supervisor can connect to subagent processes directly. For now, we accept that subagents are non-interactive and only return outputs.

---

## 11. Session State Operations

### Compact

`ent/session/compact` summarizes conversation history to reduce context usage. Returns structured data (token counts, messages compacted) rather than polluting conversation.

### Checkpoint/Rewind

`ent/session/checkpoint` and `ent/session/rewind` support file checkpointing for undo. The agent can snapshot file states and restore them.

### Configure

`ent/session/configure` allows mid-session changes to model, thinking tokens, budget, etc. Covers Claude SDK's dynamic configuration methods.

---

## 12. Discovery and Configuration Methods

The protocol includes several discovery methods that expose the agent's capabilities and configuration options:

### Tool Discovery

`ent/tools/list` allows clients to query all available tools. This complements the tool list in `initialize` capabilities but provides a queryable interface.

### Persona Discovery

`ent/personas/list` lists available agent personas that can be used to configure the agent's behavior and expertise focus.

### MCP Server Management

A suite of MCP-specific methods support dynamic server configuration:

- `ent/mcp/servers/list` - List configured MCP servers with their status and health
- `ent/mcp/servers/upsert` - Add or update MCP server configurations dynamically
- `ent/mcp/servers/delete` - Remove MCP server configurations
- `ent/mcp/servers/test` - Validate connectivity and latency for a server
- `ent/mcp/tools/list` - Discover tools available from a specific MCP server

This enables runtime configuration of MCP servers without requiring session restart.

### Workspace Management

Workspace methods support containerized or isolated execution contexts:

- `ent/workspace/info` - Query workspace state and configuration for a session
- `ent/workspace/create` - Create or initialize a workspace for a session

These support agents that work in sandboxed or containerized environments.

---

## 13. Structured Output

`session/prompt` supports an `outputFormat` parameter for JSON schema validation. The agent's response is validated against the schema and returned in `structuredOutput`.

This is essential for tool-use patterns where the client needs machine-readable output.

---

## 14. Tool Results

### Why Not Just Strings?

Early versions used `result?: string` for tool results. This causes problems:
- Tools that return structured data (file listings, search results) must serialize to strings
- Clients that want to render results nicely must parse those strings
- Error handling is ambiguous (is this string an error message or valid output?)

### The Solution: ToolResult Type

Tool results now use a structured `ToolResult` type:
- `outcome`: "completed" | "failed" | "denied" | "timeout" | "cancelled"
- `content`: Array of typed content blocks (text, json, image, error)
- `meta`: Optional tool-specific metadata

This allows:
- Rich rendering of structured data in UIs
- Clear error handling with typed error blocks
- Tool-specific metadata (e.g., file paths, match counts)
- Future extensibility for new content types

---

## 15. Error Code Design

We extend JSON-RPC standard errors with application-specific codes:

| Range | Purpose |
|-------|---------|
| -32700 to -32600 | JSON-RPC standard |
| 1-6 | ACP standard (session, permission, tool errors) |
| 7+ | Ent extensions (provider, job, budget, checkpoint) |

Each error includes structured `data` for programmatic handling.

---

## 16. Future Considerations

### ACP Evolution

ACP has draft RFDs for features we already have (session list, fork). If these ship, we can align our method signatures.

### IDE Integration

If we want to integrate with ACP clients (editors), we can build an adapter layer that:
1. Handles `fs/*` and `terminal/*` requests by having the agent execute them
2. Translates our `ent/*` methods to ACP conventions where possible

### Protocol Versioning

The `protocolVersion` field in `initialize` allows gradual evolution. Clients and agents negotiate compatible versions.

---

## 17. References

- [Protocol Specification](protocol-spec.md) - The full protocol spec
- [ACP Evaluation](../research/acp-evaluation.md) - Detailed ACP comparison
- [Protocol Gaps](../research/protocol-gaps.md) - Claude SDK coverage analysis
- [Agent Client Protocol](https://agentclientprotocol.com) - ACP specification
