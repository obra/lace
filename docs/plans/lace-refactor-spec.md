# Lace Modular Architecture Specification

## Executive Summary

This specification describes the refactoring of Lace from a monolithic in-process architecture to a modular, process-per-agent architecture. The goals are:

1. **Composability**: Each agent runs as a standalone process, enabling reuse and composition
2. **Remote-readiness**: Architecture supports both local and remote agents
3. **Clean boundaries**: Supervisor is storage-agnostic; agents own their own state
4. **Protocol-driven**: All communication via JSON-RPC 2.0 (Ent protocol extending ACP)

---

## Part 1: Architecture Overview

### 1.1 Current State (Problems)

The existing architecture has several issues that prevent modularization:

| Component | Current State | Problem |
|-----------|--------------|---------|
| **Agent** | In-process object running full loop (LLM → tools → approvals → continue) | Tightly coupled to runtime; not reusable |
| **ThreadManager** | SQLite-backed with process-local cache (`processLocalThreadCache`) | No cross-process invalidation; stale cache bugs |
| **Tool Execution** | Tools access `context.agent` for workspace, env, read-before-write | Can't run tools outside agent process |
| **Web Server** | Reaches directly into Session/Agent objects | Violates process boundaries |
| **Persistence** | Centralized SQLite via ThreadManager | Wrong abstraction for process-per-agent |

### 1.2 Target State (End-State Design)

```
┌─────────────────────────────────────────────────────────────────────┐
│                           lace-web (UI)                             │
│  - Thin HTTP server                                                 │
│  - SSE/WS event subscription                                        │
│  - Calls supervisor API only                                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP/SSE
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      lace-supervisor (Router)                       │
│  - Spawns/connects to agent processes                               │
│  - Forwards events to UI (SSE/WS)                                   │
│  - Routes user commands to agents                                   │
│  - Owns session metadata (not agent state)                          │
│  - Storage-agnostic: never reads agent files                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ JSON-RPC 2.0 (stdio / socket)
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│   lace-agent-1    │ │   lace-agent-2    │ │   lace-agent-N    │
│  - LLM loop       │ │  - LLM loop       │ │  - LLM loop       │
│  - Tool execution │ │  - Tool execution │ │  - Tool execution │
│  - Own JSONL log  │ │  - Own JSONL log  │ │  - Own JSONL log  │
│  - State from log │ │  - State from log │ │  - State from log │
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

### 1.3 Core Invariants

1. **One OS process per agent thread** (always, no pooling)
2. **Agents own their own event logs** (JSONL, single-writer)
3. **Supervisor is storage-agnostic** (never reads agent files)
4. **Tools execute in agent process** (enables remote agents)
5. **All communication via JSON-RPC 2.0** (Ent protocol)
6. **History requires live agent connectivity** (no offline UI)

---

## Part 2: Agent Process Architecture

### 2.1 Agent Responsibilities

Each agent process is a standalone unit that:

- Runs the LLM "thinking loop" (streaming tokens, tool-call selection, continuation)
- Executes tools locally (in its own environment)
- Owns and manages its event log (JSONL file)
- Derives all state from its event log
- Serves state and history via JSON-RPC methods
- Handles approval pause/resume locally

### 2.2 Event Log (JSONL Persistence)

**File Location**: `LACE_DIR/agents/<agentId>/events.jsonl`

**Format**: One JSON object per line, append-only

**Event Structure**:
```typescript
interface LaceEvent {
  seq: number;           // Monotonic sequence number
  id?: string;           // Stable ID for dedup
  type: EventType;       // USER_MESSAGE, TOOL_CALL, TOOL_RESULT, etc.
  timestamp: string;     // ISO 8601
  transient?: boolean;   // If true, not persisted (token streaming)
  data: EventData;       // Type-specific payload
}
```

**Persisted Event Types**:
- `USER_MESSAGE` - User input
- `ASSISTANT_MESSAGE` - Agent response
- `TOOL_CALL` - Tool invocation request
- `TOOL_APPROVAL_REQUEST` - Approval needed
- `TOOL_APPROVAL_RESPONSE` - User decision
- `TOOL_RESULT` - Tool execution result
- `AGENT_ERROR` - Error occurred
- `COMPACTION` - Points to snapshot blob

**Transient Events** (not persisted, or marked `transient: true`):
- Token streaming
- Thinking updates
- Usage deltas

**Crash Recovery**: Ignore trailing partial lines on read

**Compaction Strategy**:
- Periodic snapshot (`snapshot.json`) + new segment file
- OR "compaction event" pointing to summary blob
- Enables fast startup without replaying entire log

### 2.3 State Derivation

Agent derives all runtime state from its event log:

| State | Derived From |
|-------|--------------|
| Current conversation | Filter persisted USER/ASSISTANT messages |
| Pending approvals | TOOL_CALL without matching TOOL_APPROVAL_RESPONSE |
| Token usage | Sum of usage events |
| Read files (for read-before-write) | File paths from TOOL_RESULT events |
| Current turn | Latest turnId from events |

### 2.4 Tool Execution

**Location**: Tools execute inside the agent process (or on the agent's machine for remote agents)

**ToolContext Fields** (expanded, no `context.agent`):
```typescript
interface ToolContext {
  agentId: string;
  sessionId?: string;
  projectId?: string;
  workingDirectory: string;
  processEnv: Record<string, string>;
  toolTempDir: string;
  workspaceInfo: WorkspaceInfo;
  workspaceManager: WorkspaceManager;

  // Implemented by agent from its event log
  hasFileBeenRead(path: string): boolean;
}
```

**Read-Before-Write Enforcement**: Agent implements `hasFileBeenRead()` by scanning its event log for file read events.

---

## Part 3: Supervisor Architecture

### 3.1 Supervisor Responsibilities

The supervisor/router is the central coordinator that:

| Does | Does NOT |
|------|----------|
| Spawn/connect to agent processes | Read agent files (JSONL or any format) |
| Forward agent events to web UI (SSE/WS) | Own agent state or history |
| Route user commands to agents | Execute tools |
| Maintain session metadata | Manage agent persistence |
| Optional: cache/mirror events | Assume agent storage format |

### 3.2 Storage Agnosticism

**Core Principle**: Supervisor never reads agent history from disk.

- If UI needs history → supervisor calls `agent.getEvents()` via JSON-RPC
- Supervisor can cache protocol events as optimization (its own store, separate from agent)
- Agent is sole authority for its event stream

### 3.3 Session Management

Sessions are **supervisor-owned metadata**, not coupled to agent storage:

```typescript
interface Session {
  sessionId: string;
  agentIds: string[];              // Membership list
  config: SessionConfig;           // Defaults for spawned agents
  projectId?: string;              // Project grouping
  workspaceInfo?: WorkspaceInfo;   // Shared workspace
}

interface SessionConfig {
  defaultProvider?: string;
  defaultModel?: string;
  approvalMode?: ApprovalMode;
  persona?: Persona;
}
```

**Session Lifecycle**:
1. Supervisor creates session with config
2. Supervisor spawns agents, passing `sessionId` + config
3. Agents record `sessionId` in event context
4. Supervisor tracks `sessionId -> [agentId...]` mapping

---

## Part 4: IPC Protocol (JSON-RPC 2.0)

### 4.1 Transport

- **Local agents**: stdio (child_process.spawn)
- **Remote agents**: socket/websocket (same protocol surface)
- **Framing**: JSON-RPC 2.0 with NDJSON

### 4.2 Supervisor → Agent Methods

| Method | Parameters | Purpose |
|--------|-----------|---------|
| `agent.init` | `{ agentId, sessionId?, config }` | Initialize agent |
| `agent.sendUserMessage` | `{ content, clientMessageId? }` | Send user message |
| `agent.abort` | `{}` | Abort current turn |
| `agent.getInfo` | `{}` | Get agent metadata |
| `agent.getEvents` | `{ afterSeq?, limit? }` | Page through history |
| `agent.getPendingApprovals` | `{}` | List pending approvals |
| `agent.respondApproval` | `{ toolCallId, decision }` | Respond to approval |
| `agent.compact` | `{ strategy?, upToSeq? }` | Trigger compaction |

### 4.3 Agent → Supervisor Notifications

| Notification | Payload | Purpose |
|-------------|---------|---------|
| `event.append` | `{ seq, event }` | Emit durable event (forwarded to UI) |
| `agent.status` | `{ status }` | Status change (optional) |

### 4.4 Approval Flow

```
Agent                              Supervisor                         UI
  │                                    │                               │
  │── TOOL_CALL event ────────────────>│                               │
  │── TOOL_APPROVAL_REQUEST ──────────>│── forward ──────────────────>│
  │   (enters awaiting_approval state) │                               │
  │                                    │<────── user clicks allow ─────│
  │<── agent.respondApproval ──────────│                               │
  │   (if allowed: execute tool)       │                               │
  │── TOOL_APPROVAL_RESPONSE ─────────>│                               │
  │── TOOL_RESULT ────────────────────>│── forward ──────────────────>│
  │   (continue turn)                  │                               │
```

---

## Part 5: Ent Protocol (ACP Extension)

### 5.1 Relationship to ACP

Ent is an **extension** of ACP (Agent Communication Protocol):
- Uses ACP naming conventions: `sessionId`, `turnId`, `jobId`, `toolCallId`
- Adds connection/provider management for multi-backend support
- Backwards-compatible: wrappers can ignore unsupported methods

### 5.2 Naming Conventions

| Concept | Wire Field Name | Notes |
|---------|-----------------|-------|
| Session | `sessionId` | ACP standard |
| Turn | `turnId` | ACP standard |
| Job/subagent | `jobId` | ACP standard |
| Tool invocation | `toolCallId` | ACP standard |
| Tool result ref | `toolUseId` | ACP standard |
| Provider family | `provider` | Opaque string (ACP-compatible) |
| Model | `model` | Opaque string (ACP-compatible) |
| Connection | `connectionId` | New: concrete endpoint + credentials |

### 5.3 Provider/Connection Model

```
Provider (family/runtime, e.g., "anthropic", "openai")
├─ Capabilities: { supportsConnections, supportsCatalogRefresh }
├─ Connection 1 (concrete endpoint + credentials)
│  ├─ config: { name, baseURL } (non-secret, mutable)
│  ├─ credentials: { state, accountLabel, expiresAt } (secret, mutable)
│  └─ models: [available models for this connection]
└─ Connection N
```

**Key Invariants**:
1. Connection ⇔ Provider pairing is immutable
2. Credentials are mutable (rotation supported)
3. Credentials never appear in event streams or error messages
4. Model catalogs are connection-scoped

### 5.4 Ent Methods

**Provider Discovery**:
- `ent/providers/list` → List available providers with capabilities

**Connection Management**:
- `ent/connections/list({ provider? })` → List connections
- `ent/connections/upsert({ provider, connection })` → Create/update
- `ent/connections/delete({ connectionId })` → Delete
- `ent/connections/test({ connectionId, modelId? })` → Validate

**Credential Management**:
- `ent/connections/credentials/status({ connectionId })` → Auth state
- `ent/connections/credentials/start({ connectionId, method? })` → Start login
- `ent/connections/credentials/submit({ connectionId, values })` → Submit creds

**Model Management**:
- `ent/models/list({ connection })` → List models for connection
- `ent/models/refresh({ connection })` → Refresh catalog

**Session Configuration**:
- `initialize.config`: `{ provider, model, connection? }`
- `ent/session/configure`: `{ connection?, model?, approvalMode? }`
- `ent/agent/status.currentSession`: `{ provider, model, connection }`

### 5.5 Configuration Ownership

| Concern | Owner | Where Stored |
|---------|-------|--------------|
| Provider instances | Agent | Agent-local store |
| Credentials | Agent (supervisor configures) | Agent-local store |
| Active selection | Agent | Agent config |
| Session membership | Supervisor | Supervisor metadata |
| Project identity | Supervisor (UX) + Agent (persisted) | Agent event context |

**Scope**: Provider instances are **global** (per-user/per-machine), not per-project:
- Any agent process can read/write the same provider instance store
- Supervisor configures once; spawns many agents using them
- Projects store `defaultProviderInstanceId` for selection

---

## Part 6: Migration Plan

### 6.1 Incremental Steps

1. **Define Runtime API surface** (even if in-process initially)
   - `spawnAgent`, `sendMessage`, `abort`, `listAgents`, `streamEvents`

2. **Move web server onto Runtime API**
   - Replace SessionService reaching into Session/Agent directly

3. **Refactor ToolContext** (remove `context.agent` coupling)
   - Add explicit fields to ToolContext
   - Update `executor.ts`, `tool.ts`, delegate tools

4. **Implement worker protocol + supervisor**
   - JSON-RPC 2.0 over stdio
   - Spawn per agent, route messages

5. **Cut over to worker-backed agents**
   - Runtime uses process agents instead of in-process

### 6.2 Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/tools/executor.ts` | Stop calling `context.agent.getFullSession()` |
| `packages/core/src/tools/tool.ts` | Use `context.hasFileBeenRead()` not `context.agent.hasFileBeenRead()` |
| `packages/core/src/tools/implementations/delegate.ts` | Use `actorThreadId`/`sessionId` from context |
| `packages/core/src/agents/agent.ts` | Extract to standalone process with JSONL persistence |
| `packages/core/src/threads/thread-manager.ts` | Replace with per-agent event log |
| `packages/web/lib/server/session-service.ts` | Use Runtime API, not in-process objects |

---

## Part 7: Design Decisions Summary

### Agreed Decisions

| Decision | Rationale |
|----------|-----------|
| One process per agent thread (always) | Clean isolation, remote-ready |
| JSON-RPC 2.0 over stdio | Debuggable, works everywhere |
| Tools execute in agent process | Enables remote agents |
| JSONL per-agent (not SQLite) | Single-writer, no cache invalidation |
| Supervisor is storage-agnostic | Clean boundary, testable |
| History requires live connectivity | Simplifies architecture |
| ToolContext expansion (not new abstraction) | Minimal change, explicit deps |
| Sessions are supervisor metadata only | Decouples from agent storage |
| Provider instances are global scope | Avoid credential duplication |
| ACP naming conventions | Interoperability |

### Open Questions (Deferred)

| Question | Current Status |
|----------|---------------|
| Subagent/job spawning semantics | Noted as next focus |
| Session vs "everything is agents" | Sessions retained for now |
| Remote transport details | Assumed socket later; stdio first |
| Wrapper compatibility testing | Guidance provided |

---

## Appendix A: Event Type Reference

```typescript
type EventType =
  | 'USER_MESSAGE'
  | 'ASSISTANT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_APPROVAL_REQUEST'
  | 'TOOL_APPROVAL_RESPONSE'
  | 'TOOL_RESULT'
  | 'AGENT_ERROR'
  | 'TURN_START'
  | 'TURN_END'
  | 'COMPACTION'
  | 'TOKEN_STREAM'      // transient
  | 'THINKING_UPDATE'   // transient
  | 'USAGE_UPDATE';     // transient
```

## Appendix B: Message Flow Diagram

```
Supervisor                           Agent Process
    │                                      │
    │── agent.init ───────────────────────>│
    │                                      │ (load JSONL, derive state)
    │                                      │
    │── agent.sendUserMessage ────────────>│
    │                                      │ (append USER_MESSAGE)
    │<──────────── event.append ───────────│
    │                                      │ (run LLM turn)
    │<──────────── event.append (tokens) ──│ (transient)
    │<──────────── event.append (TOOL_CALL)│
    │<──────────── event.append (APPROVAL_REQ)│
    │                                      │ (pause: awaiting_approval)
    │                                      │
    │── agent.respondApproval ────────────>│
    │                                      │ (execute tool locally)
    │<──────────── event.append (APPROVAL_RSP)│
    │<──────────── event.append (TOOL_RESULT)│
    │                                      │ (continue turn)
    │<──────────── event.append (ASSISTANT_MSG)│
    │                                      │
```
