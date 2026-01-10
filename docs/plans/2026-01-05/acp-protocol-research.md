# ACP Protocol Research

**Date:** 2026-01-05 **Status:** Research complete **Summary:** ACP is NOT an
Anthropic protocol. There are actually TWO protocols named "ACP" from different
organizations. Lace's Ent protocol was designed with awareness of and
compatibility with the Zed ACP.

---

## Executive Summary

My research found:

1. **"ACP" is NOT an Anthropic protocol** - Anthropic created MCP (Model Context
   Protocol)
2. **Two different protocols are named "ACP":**
   - **Zed's Agent Client Protocol** - IDE-to-agent communication (relevant to
     Lace)
   - **IBM/BeeAI's Agent Communication Protocol** - Agent-to-agent collaboration
     (not relevant)
3. **Lace already evaluated and designed around Zed's ACP** - See existing docs
   in `docs/about-the-protocol.md`
4. **Anthropic's streaming uses SSE with specific event types** - well
   documented in their SDK docs

---

## 1. The Two "ACP" Protocols

### 1.1 Zed's Agent Client Protocol (Relevant)

**Source:** [Zed ACP](https://zed.dev/acp) |
[GitHub](https://github.com/zed-industries/agent-client-protocol)

Zed's Agent Client Protocol enables communication between code editors (IDEs)
and AI coding agents. Key characteristics:

| Aspect               | Description                                         |
| -------------------- | --------------------------------------------------- |
| **Purpose**          | IDE-to-agent integration (like LSP for AI agents)   |
| **Primary client**   | Code editors (Zed, JetBrains, Neovim, Eclipse)      |
| **Transport**        | JSON-RPC over stdio                                 |
| **Key feature**      | Client (editor) mediates filesystem/terminal access |
| **Supported agents** | Gemini CLI, Claude Code, Codex, Goose, Aider        |

**Key protocol methods:**

- `initialize` / `shutdown`
- `session/new`, `session/load`, `session/prompt`
- `session/update` (notifications)
- `session/request_permission`
- `fs/*` and `terminal/*` methods (client-mediated)

**Industry adoption** (as of late 2025):

- JetBrains announced ACP support for IntelliJ IDEA, PyCharm
- Neovim support via CodeCompanion plugin
- Eclipse prototype exists
- marimo notebook environment added support

### 1.2 IBM/BeeAI's Agent Communication Protocol (Not Relevant)

**Source:**
[IBM ACP](https://www.ibm.com/think/topics/agent-communication-protocol) |
[BeeAI Docs](https://docs.beeai.dev/acp/pre-alpha/introduction)

IBM's Agent Communication Protocol is for **agent-to-agent** collaboration
(multi-agent systems). Key differences from Zed's ACP:

| Aspect        | Zed ACP                     | IBM ACP               |
| ------------- | --------------------------- | --------------------- |
| **Focus**     | IDE-to-agent                | Agent-to-agent        |
| **Transport** | JSON-RPC                    | REST/HTTP             |
| **Mediation** | Editor mediates FS/terminal | Agents talk directly  |
| **Use case**  | Code editing                | Multi-agent workflows |

**Important note:** IBM's ACP has merged with Google's A2A protocol under the
Linux Foundation. Active development is winding down.

---

## 2. Anthropic's Protocols

Anthropic has created **two** relevant protocols:

### 2.1 MCP - Model Context Protocol

**Source:** [MCP Spec](https://modelcontextprotocol.io/specification/2025-11-25)
|
[Anthropic Announcement](https://www.anthropic.com/news/model-context-protocol)

MCP is Anthropic's "USB-C port for AI" - standardizing how LLMs connect to tools
and data sources.

| Aspect            | Description                              |
| ----------------- | ---------------------------------------- |
| **Purpose**       | Tool/data integration for LLMs           |
| **Transport**     | stdio (NDJSON) or HTTP+SSE               |
| **Foundation**    | JSON-RPC 2.0 (like LSP)                  |
| **Message types** | Requests, Results, Errors, Notifications |
| **Key features**  | Tool discovery, resource access, prompts |

**Streaming:** MCP supports Server-Sent Events (SSE) for real-time
communication.

### 2.2 Claude API Streaming

**Source:**
[Anthropic Streaming Docs](https://docs.anthropic.com/en/docs/build-with-claude/streaming)

Anthropic's Messages API uses SSE for streaming responses with a specific event
flow:

```
message_start
  -> content_block_start
    -> content_block_delta (repeated)
  -> content_block_stop
  -> content_block_start (for next block)
    -> ...
  -> content_block_stop
-> message_delta (final usage)
-> message_stop
```

**Event types:**

- `message_start` - Contains Message object with empty content
- `content_block_start` - Start of text/tool_use block
- `content_block_delta` - Incremental content
- `content_block_stop` - End of content block
- `message_delta` - Final message updates (stop_reason, usage)
- `message_stop` - Stream complete
- `ping` - Keep-alive

---

## 3. Lace's Ent Protocol vs Zed ACP

Lace has its own protocol ("Ent") that was **designed with ACP compatibility in
mind**. From `docs/about-the-protocol.md`:

### Design Decision: Why Not Just Use ACP?

The Lace team evaluated Zed's ACP and documented the comparison:

| Aspect             | Zed ACP                     | Lace Ent         |
| ------------------ | --------------------------- | ---------------- |
| Primary client     | Code editors (Zed, VS Code) | CLI              |
| FS/terminal access | Client-mediated             | Agent-direct     |
| Focus              | IDE integration             | Standalone agent |

**Key architectural difference:**

- ACP is **client-centric**: The editor owns filesystem and terminal access.
  When the agent needs to read a file, it sends `fs/read_text_file` to the
  client.
- Ent is **agent-centric**: The agent has direct access. It reads files, runs
  commands, and reports what it did via `session/update`.

### ACP Compatibility Strategy

From the protocol spec:

> Use our own protocol, but design for ~80% ACP compatibility. This lets us
> potentially integrate with ACP clients in the future while optimizing for our
> CLI use case now.

**Compatibility approach:**

- Same method names where possible (`initialize`, `session/prompt`, etc.)
- Extensions prefixed with `ent/` (e.g., `ent/session/compact`)
- Declare `fileSystem: false` and `terminal: false` to tell ACP clients "don't
  ask me for FS/terminal"

### Ent-Specific Extensions

Methods that don't exist in Zed's ACP:

- `ent/session/compact` - Context compaction
- `ent/session/inject` - Mid-turn context injection
- `ent/job/*` - Background job management
- `ent/session/events` - History replay
- `ent/providers/*`, `ent/connections/*` - Provider/connection management

---

## 4. Turn Lifecycle in Each Protocol

### Zed ACP Turn Lifecycle

ACP's turn lifecycle is implicit in the `session/prompt` request/response
pattern:

1. Client sends `session/prompt` request
2. Agent streams `session/update` notifications during processing
3. Agent sends `session/prompt` response when complete

### Anthropic API Turn Lifecycle

SSE-based with explicit events:

1. `message_start` - Turn begins
2. Multiple `content_block_*` events
3. `message_delta` - Final updates
4. `message_stop` - Turn complete

### Lace Ent Turn Lifecycle

Currently:

- `turn_start` / `turn_end` exist as **durable events** only
- Not streamed via `session/update` (see `session-update-protocol-analysis.md`)
- Client infers turn boundaries from `session/prompt` response

**Gap identified:** Could add `turn_start`/`turn_end` streaming for explicit
lifecycle events.

---

## 5. Recommendations

### No Action Needed on ACP

Lace's Ent protocol already accounts for Zed's ACP:

- Compatibility strategy is documented
- Extensions use `ent/` prefix
- Agent-centric design is intentional for CLI use case

### IBM's ACP is Not Relevant

IBM's Agent Communication Protocol is for agent-to-agent scenarios. Lace's
multi-agent support uses its own job system (`ent/job/*`).

### Consider Adding turn_start/turn_end Streaming

As documented in `session-update-protocol-analysis.md`, adding these as
streaming events would:

- Provide explicit turn lifecycle notifications
- Align with `job_started`/`job_finished` pattern
- The TUI already expects these events

---

## Sources

### Zed Agent Client Protocol

- [Zed ACP Homepage](https://zed.dev/acp)
- [GitHub: zed-industries/agent-client-protocol](https://github.com/zed-industries/agent-client-protocol)
- [JetBrains ACP Announcement](https://blog.jetbrains.com/ai/2025/10/jetbrains-zed-open-interoperability-for-ai-coding-agents-in-your-ide/)
- [ACP Progress Report](https://zed.dev/blog/acp-progress-report)

### IBM Agent Communication Protocol

- [IBM ACP Overview](https://www.ibm.com/think/topics/agent-communication-protocol)
- [BeeAI Documentation](https://docs.beeai.dev/acp/pre-alpha/introduction)
- [GitHub: i-am-bee/acp](https://github.com/i-am-bee/acp)

### Anthropic Protocols

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Anthropic Streaming Messages](https://docs.anthropic.com/en/docs/build-with-claude/streaming)
- [Introducing MCP](https://www.anthropic.com/news/model-context-protocol)

### Protocol Comparison Articles

- [MCP, A2A, ACP Explained - WorkOS](https://workos.com/guide/understanding-mcp-acp-a2a)
- [Developer's Guide to AI Protocols - InfoWorld](https://www.infoworld.com/article/4007686/a-developers-guide-to-ai-protocols-mcp-a2a-and-acp.html)
- [MCP, A2A, ACP: What Does It Mean - Akka](https://akka.io/blog/mcp-a2a-acp-what-does-it-all-mean)

### Lace Internal Documentation

- `/Users/jesse/Documents/GitHub/lace/docs/about-the-protocol.md` - Ent protocol
  design decisions
- `/Users/jesse/Documents/GitHub/lace/docs/protocol-spec.md` - Full Ent protocol
  specification
- `/Users/jesse/Documents/GitHub/lace/docs/plans/2026-01-05/session-update-protocol-analysis.md` -
  Turn lifecycle analysis
