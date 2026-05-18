# Building Agents on Lace

This guide is for anyone building an agent product on top of lace. It lays out the architectural model lace expects, the patterns that work, and the anti-patterns that produce silent regressions.

If you find yourself wanting to import lace's internal classes, construct your own `ConversationRunner`, or mirror lace's `server.ts` orchestration, **stop and read this**. That path produced 12 BLOCKER-level regressions in sen-core in a single week of development. Don't repeat that.

## The mental model

Lace is an agent runtime. It owns:

- Sessions (event log, persona state, conversation history)
- Conversation lifecycle (the turn loop, tool dispatch, streaming)
- Tool execution (built-in tools, MCP tools, permissions)
- MCP server lifecycle (per-session reconcile, transport, discovery)
- Job management (subagent spawns, background bash, resume by job ID)
- Provider integration (model catalogs, instances, request shape)
- Workspace abstraction (local, worktree, container)
- Skill registry and prompt assembly via TemplateEngine

Your product owns:

- The *use case* — what you're building agents for (a chatbot, a CLI, a CI runner, a Slack adapter)
- Inbound event sources (chat messages, webhooks, schedules) and the queue/coalescing for them
- Outbound integrations (where the agent's output goes, formatting)
- Per-product tools (your product's APIs) **as MCP servers, not as imports**
- Persona files describing the agents your product runs
- Process supervision (you spawn lace and manage its lifecycle)

The boundary is **Ent over stdio**. Lace exposes JSON-RPC for everything: create a session, send a prompt, stream updates, list jobs, manage MCP servers. Your product spawns lace as a child process and talks to it via Ent. That's the contract.

## The anti-pattern: in-process embedding

It is technically possible to import lace's internals and run them in-process. There were even helper classes labeled "library API" — `createAgentSession`, `AgentSession`, the orchestration closures in `core/state-orchestration.ts`. **Those are being removed.** They existed because someone tried to take the in-process shortcut and ran into every wall lace puts in their way, then carved out enough of lace's internals to feel like it was working.

Concretely, in-process embedding will force you to:

- Re-implement `runExclusive`, `emitSessionUpdate`, `persistEvent` (they're closures inside `registerAgentRpcMethods`, not exported helpers — and that's intentional)
- Wire `JobManager` with the right `runShellJobProcess`, `runSubagentJobProcess`, `finalizeJob`, `setupProgressTimer`, `persistEvent`, `emitUpdate`, `getActiveSession`, and `requestPermissionFromClient` callbacks (eight of them, in the right order, with the right semantics)
- Decide whether you have your own `runExclusive` per-session or share state's (the answer is: share state's; if you don't, jobs lose their orchestration tether)
- Realize the subagent-job path spawns `process.execPath process.argv[1]` and that's *your* binary, not lace's — which means subagents will run your code, not lace's, unless you ship a special "subagent worker" entrypoint
- Reconcile MCP servers for the active session, including invalidating the tool-executor cache when the MCP set changes
- Construct a `SkillRegistry` and thread it into both the tool-executor builder and the conversation-runner dependencies
- Persist the core session ID across process restarts (otherwise your agent forgets the user every time the process dies)
- Wire abort propagation through `runOne` to `ConversationRunner` to spawn-child signals
- Emit `turn_end` SessionUpdate events yourself because nobody else does

Every one of those was missed at least once during sen-core's embedded-lace attempt. They were caught by a post-hoc audit, not by code review. **The in-process path is uniformly more dangerous than it looks.**

If you're sure you need in-process for performance reasons: you don't. JSON-RPC over stdio adds microseconds per message. The model call dwarfs it.

## The right shape

```
[Your product]                       [Lace agent]
     │
     │  spawn lace-agent as a child process
     │ ──────────────────────────────────────►
     │
     │  JSON-RPC over stdio (Ent protocol)
     │ ◄────────────────────────────────────►
     │
     │  Subagents:                       Subagents:
     │                                   ├─ child lace-agent process
     │                                   ├─ same Ent protocol
     │                                   └─ optionally inside a container
     │
     │  MCP servers:                     MCP servers:
     │  ├─ host-provided                 ├─ spawned per-session
     │  │   (your product's APIs as      │   per session config
     │  │    a stdio MCP server you ship)
     │  └─ standard third-party MCPs
```

Your process spawns one lace-agent child. That child handles one or more sessions. When it needs to delegate to a subagent, *lace* spawns another lace-agent process (in a container if you've configured isolation that way). MCP servers attach to lace's session-managed MCP pool.

## Bootstrapping a client

Roughly:

```ts
import { spawn } from 'node:child_process';
import { JsonRpcPeer, createNdjsonStdioTransport } from '@lace/ent-protocol';

const child = spawn('lace-agent', ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
const transport = createNdjsonStdioTransport({
  readable: child.stdout!,
  writable: child.stdin!,
});
const peer = new JsonRpcPeer(transport);

await peer.request('initialize', { laceDir: '/path/to/lace-dir' });
```

`laceDir` is where lace stores sessions, provider catalogs, MCP configs, agent personas, and skills. It should be a persistent directory under your product's data root.

For subscribing to streaming updates (token deltas, tool call events, turn boundaries):

```ts
peer.handleNotification('session/update', (params) => {
  // params.update has type, content, etc.
  // Forward to your UI, log, message bus, whatever.
});
```

## Sessions

A session is one conversation thread. It has an event log, a persona, a connection (provider + model), and per-session MCP config.

Create a session:

```ts
const { sessionId } = await peer.request('session/new', {
  workDir: '/some/dir',
  config: {
    connectionId: 'anthropic-main',
    modelId: 'claude-opus-4-7',
    persona: 'default',
    mcpServers: [
      { name: 'knowledge', command: 'tsx', args: ['./mcp-servers/knowledge.ts'], enabled: true },
    ],
  },
});
```

Send a prompt:

```ts
const result = await peer.request('session/prompt', {
  sessionId,
  content: [{ type: 'text', text: 'hello' }],
});
```

`session/prompt` returns the final assistant message. Streaming token-by-token updates arrive via `session/update` notifications during the call.

End / abandon a session:

```ts
await peer.request('session/end', { sessionId });
```

**Persist the sessionId for your top-level conversations.** If your product runs an always-on agent (a chatbot, a Slack listener, a daemon), write the sessionId to your data directory at first boot. Reuse it on every subsequent boot via `session/load` — otherwise your agent forgets everything on every restart.

## Personas

A persona is a named bundle of agent configuration. As of [the persona-bundle frontmatter feature], a persona file looks like:

```md
---
model: haiku
tools:
  - knowledge/grep
mcpServers:
  knowledge:
    command: tsx
    args: [./mcp-servers/knowledge.ts]
maxTurns: 50
---

# You are the librarian.

[body = the persona's system prompt template — `@file.md` transclusions
work via TemplateEngine, including `{{include:...}}` and `@dir/*.md`-style
glob expansion]
```

Frontmatter is optional. If omitted, the persona is a template-only persona (just a system prompt; model/tools/MCPs come from session-level config or your delegate call).

**`tools:` is additive over lace builtins.** Lace builtin tools (`bash`, `file_read`, `file_write`, `file_edit`, `ripgrep_search`, `file_find`, `url_fetch`, `delegate`, `job_output`, `jobs_list`, `job_kill`, `todo_read`, `todo_write`, `use_skill`) are platform tools and are always available to any persona-launched session. You only need to list the specialized additions your persona needs — typically MCP-namespaced tools like `knowledge/grep`. The effective `toolScope` is the union of builtins and the persona's `tools:` entries.

Personas live in two places (user overrides bundled):

- Bundled: shipped with lace
- User: `${LACE_DIR}/agent-personas/<name>.md`

Use the same registry resolution for any product-specific personas — drop them into `${LACE_DIR}/agent-personas/` at install time, or seed them on first boot.

## Delegate: dispatching to typed subagents

The `delegate` tool spawns a subagent, optionally on a named persona. From the agent's side:

```ts
delegate({ prompt: 'search knowledge for X, return bullets', persona: 'librarian' })
```

When `persona` is set, lace:

1. Looks up `librarian` in the persona registry
2. Reads the persona's frontmatter (`model`, `tools`, `mcpServers`, `maxTurns`)
3. Spawns a subagent session with those as defaults
4. Uses the persona's body as the system prompt template
5. Returns the result (or a jobId in background mode)

Per-call overrides (`connectionId`, `modelId`) still work and take precedence over frontmatter.

`delegate` also supports:

- `background: true` → returns `{ jobId, status: 'started' }` immediately. Use `job_output(jobId)` to check status.
- `resume: <jobId>` → continues a previous delegate session with a new prompt. Works across sync and background.
- `progressIntervalMs` → for background jobs, how often progress notifications fire.

All delegate jobs are resumable. The subagent session persists after completion.

## Tools

There are three ways tools get into a lace session:

1. **Built-in tools** — lace ships these (bash, file_*, ripgrep_search, url_fetch, todo_*, etc.)
2. **MCP tools** — anything attached as an MCP server (knowledge, journal, browser, etc.)
3. **Host-provided tools via MCP** — when *your product* needs to expose its own APIs to the agent (e.g., "send a Slack message"), ship them as a stdio MCP server that your process hosts. Lace consumes it like any other MCP.

**Do not import lace's `Tool` class and define your own tools that lace will execute in-process.** The host-tool-via-MCP pattern is the supported integration. It works because MCP is lace's tool extensibility contract; the `Tool` class is an internal implementation detail.

For a chat product like a Slack bot:

- The agent has a tool called `slack/send_message` exposed by your `slack-mcp` server
- The agent has a tool called `slack/list_users` etc. likewise
- The agent has no awareness of your event loop, your message routing, your channel mappings — all of that lives in the MCP server (and the product behind it)

## Containers

Subagents that need isolation run inside containers. Lace's `runSubagentJobProcess` already spawns subagent sessions as child processes communicating via stdio Ent — running that child *inside a container* is mechanically the same flow.

How it's configured: a persona's frontmatter can declare `workspace: container`. When delegate spawns that persona's subagent, lace creates a containerized workspace (via `WorkspaceContainerManager`) and spawns the subagent process inside it. Tool calls (bash, file_*) execute against the container's filesystem. The container persists across resume — it's bound to the subagent's session, not to individual turns.

For long-lived persistent containers (a browser session, a daemon agent), the workspace is created at the subagent's first prompt and lives until the session is explicitly ended.

## Process supervision

Your product process supervises the lace-agent child. Concerns:

- **Crash recovery.** If lace-agent exits non-zero, spawn a fresh one. The new process loads the persistent sessionId. In-flight prompts at the moment of crash are lost; your inbound queue should not ack a prompt until the corresponding `session/prompt` returns. If you ack early and lose the response, the user sees a stuck message.
- **Graceful shutdown.** SIGTERM should reach lace-agent (it handles its own cleanup). Don't kill -9 unless lace has been unresponsive for many seconds.
- **stderr.** Lace logs to stderr. Forward it to your product's log stream, not /dev/null.

## What lace will *not* do for you

- **Inbound event handling.** You read from Slack/web/whatever and decide when to call `session/prompt`. Lace doesn't poll anything on your behalf.
- **Outbound formatting.** Lace returns the assistant's final text (and structured content blocks). How that becomes a Slack message, an email, an HTTP response is your job. Use MCP tools to give the agent direct outbound capability if appropriate; otherwise route the turn result yourself.
- **Authentication.** You handle credentials. Pass them to MCP servers via env vars, never via tool arguments.
- **Multi-tenancy.** One lace-agent process serves one user/persona/etc. If you have multiple Sen instances on one host, run separate lace-agent processes.
- **Schedulers and cron.** Out of scope. Build them in your product.

## Common patterns

### Always-on chat agent (Slack bot, Discord bot, etc.)

```
[Slack listener] ──► [inbox + coalescer] ──► [ambient loop] ──► session/prompt
                                                                      │
                                                                      ▼
                                                              [lace-agent]
                                                                      │
                                                                      ├─ tool calls (incl. slack-mcp send_message)
                                                                      │
                                                                      ▼
                                                              SessionUpdate stream
                                                                      │
                                                                      ▼
                                                      [your product handles turn_end,
                                                       per-turn side effects like
                                                       git commits, ops logging]
```

The ambient loop coalesces inbound events between turns. The agent's outbound (sending Slack messages) goes through an MCP tool. Per-turn product concerns (logging, persistence) hook on `turn_end` from the SessionUpdate stream.

### CLI agent

```
[user types prompt] ──► session/prompt (one-shot or interactive)
                              │
                              ▼
                       [lace-agent]
                              │
                              ▼
                      SessionUpdate stream
                              │
                              ▼
                  [render to terminal]
```

### CI / batch runner

```
[CI trigger] ──► [your runner] ──► session/prompt (with task description)
                                          │
                                          ├─ subagents spawned per work item
                                          │  via delegate (background: true)
                                          │
                                          ▼
                            jobs_list ──► poll for completion
                                          │
                                          ▼
                          collect outputs, write back to CI
```

## Anti-patterns: a checklist

If you find yourself doing any of these, stop and reconsider:

- Importing `ConversationRunner`, `AgentServerState`, `JobManager`, or any class from `@lace/agent/core/*` or `@lace/agent/jobs/*` outside of lace itself
- Building closures named `runExclusive`, `persistEvent`, `emitSessionUpdate` in your product
- Constructing `JobManager` yourself, even with lace's helpers
- Reading from `state.activeSession` or writing to it
- Spawning child processes that share lace's state via shared filesystem instead of via Ent
- Defining a tool by extending `Tool` from `@lace/agent/tools/tool` and registering it on lace's executor
- Implementing your own version of any of these, declaring victory, then adding "documented limitation" or "follow-up task" comments — those phrases describe regressions, not deferrals

If you have a legitimate use case that the Ent protocol doesn't cover, file an issue or contribute a new RPC method. Don't shim around it.

## Glossary

- **Ent protocol** — JSON-RPC dialect lace speaks for client-server communication.
- **LACE_DIR** — per-product data root for lace: sessions, agent personas, provider catalogs, MCP configs.
- **Workspace** — execution environment for a session. Local (host fs), worktree (git worktree on host), or container (isolated).
- **Persona** — named agent profile: prompt template + optional config bundle (model, tools, MCPs).
- **Job** — long-running work tracked by `JobManager`. Subagent calls and background bash both create jobs.
- **Session update** — streaming notification of agent state changes: tokens, tool calls, turn boundaries, errors.

## When this guide is wrong

Lace is under development; the protocol evolves. If something in this guide doesn't match the code, the code wins — and please update this doc or file an issue.

The pattern above is the one lace is being designed for. Departures from it should require explicit justification, not just expedience.
