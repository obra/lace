# Spec - Tool Runtime Projection For Host-Run Agents

**Status:** Draft for review. **Date:** 2026-05-18. **Related:**
`docs/specs/2026-05-18-container-runtime-spec.md`, kata #49.

## Spec Boundary

This document defines the target architecture and behavioral contract for
projected tool runtimes. It is not the implementation plan. Once this spec is
approved, we will write a separate implementation plan that decomposes the work
into small, reviewable changes.

Implementation must not start from this document alone. The implementation plan
is the gate that defines task order, review boundaries, and verification for
each change.

## Summary

Lace currently has three related ideas that are not cleanly separated:

- A host/local session, where the agent process and tools both run on the host.
- A workspace mapping path, where host-side file tools can optionally be pointed
  at a cloned or mapped workspace through `ToolContext.workspaceInfo`.
- A persona container runtime, where the subagent lace-agent process itself runs
  inside a long-lived container.

The missing shape is a projected runtime: the lace-agent process can stay on the
host while its tools behave as if they are inside a workspace or container. For
host-orchestrated agents this should be the preferred container model: traces,
job logs, provider credentials, checkpoints, and session storage stay on the
host, while filesystem/process/network tool effects happen inside the projected
runtime.

That avoids the two worst bookkeeping problems of running the whole lace-agent
inside the container:

- getting agent traces and session artifacts back out of the container, and
- getting the Lace codebase plus agent/provider credentials into the container.

The right abstraction is not "if container, branch inside each tool". The right
abstraction is a `ToolRuntime` capability object built once per session/job and
passed through `ToolContext`. Tools call runtime capabilities for filesystem,
process, network, and MCP server execution. Runtime implementations decide
whether that work happens on the host, in a workspace clone, or in a container.

This keeps the existing lace-in-container subagent path available for explicitly
self-contained personas, while adding a cleaner default path for projected
containers.

## Current State

### What exists

- `ConversationRunner.executeToolByName()` builds `ToolContext` with
  `workingDirectory`, `toolTempRoot`, `processEnv`, `hasFileBeenRead`, and job
  metadata.
- File tools call `Tool.resolveWorkspacePath()`, which can use optional
  `workspaceInfo` to rewrite project paths into a host clone path. Ordinary
  sessions currently pass only `workingDirectory`, so this is not a complete
  runtime binding.
- `BashTool` ignores `workspaceInfo` and runs `/bin/bash -c` on the host with
  `cwd: context.workingDirectory`.
- Background bash jobs in `jobs/shell-job.ts` also run on the host with
  `cwd: state.activeSession.meta.workDir`.
- Container personas currently avoid projection by spawning a child lace-agent
  inside the container through `ContainerManager.execStream()`.
- MCP servers start through `StdioClientTransport`, which spawns host child
  processes with `cwd: state.activeSession.meta.workDir`.

### Consequence

The current partial projection is path-only and file-tool-only. It does not
project process execution, network view, MCP servers, background jobs, skill
loading, or container-local files. A host-run agent projected into a container
would produce inconsistent behavior:

- `bash("echo hi > /tmp/x")` would write to host `/tmp`, not container `/tmp`.
- `file_read("/tmp/x")` would read the host path unless extra path translation
  existed.
- `ripgrep_search()` would use host `rg`, host gitignore behavior, and host
  filesystem.
- An MCP filesystem server would run on the host and see a different filesystem
  than projected tools.

## Goals

- Make tool execution target explicit and uniform across built-in tools.
- Let a host-run agent project all tools into a container without running the
  lace-agent process inside that container.
- Keep agent-owned artifacts on the host: durable events, trace files, job
  output logs, checkpoints, provider configuration, and provider credentials.
- Avoid requiring projected containers to contain the full Lace source tree,
  Lace dist, session storage, or provider credentials.
- Keep adding a new tool simple: the tool should use runtime capabilities, not
  branch on local/workspace/container.
- Keep `toolTempRoot` and job output files host-side so UI/job-log plumbing does
  not need container mounts.
- Make MCP server placement explicit enough that filesystem-sensitive MCP tools
  share the projected runtime, while host service MCPs can still run on the
  host.

## Non-Goals

- Do not replace the existing lace-in-container subagent runtime in this spec.
  It remains valid for personas that want the whole child agent inside the
  container.
- Do not run LLM provider calls from inside the projected container. The model
  client remains part of the host agent process.
- Do not implement a general remote filesystem protocol beyond what tool
  execution needs.
- Do not add resource limits, network policy, or sandbox policy here.
- Do not make HTTP/SSE MCP transports projected in v1. The current manager is
  stdio-oriented; stdio placement is the critical path.

## Projected Runtime Versus Lace-In-Container

There are two valid container stories, and they should stay distinct.

### Preferred For Host-Orchestrated Agents: Projected Runtime

Use projected runtime when the parent Lace process owns the agent lifecycle and
the container is the tool environment. This is the Sen-style shape:

- the agent, provider client, credentials, session storage, traces, and UI
  plumbing stay on the host;
- built-in tools run their filesystem, process, network, and runtime-placed MCP
  work through the container runtime;
- job output is streamed back to host-side logs as it happens; and
- the container only needs the target project/tool environment plus a small
  runtime helper when host-mount fast paths are insufficient.

This gives the model a container view without making the container responsible
for being a Lace deployment target.

### Explicit Alternate: Lace-In-Container

Use lace-in-container when a persona intentionally needs a self-contained child
agent process inside the container. That path already exists through
`spawnSubagent()` and `ContainerManager.execStream()`. It requires the container
image or compose setup to provide the Lace agent entrypoint and any runtime data
the child agent needs.

The two modes should not be inferred from the same flag. Runtime target and
agent placement are separate choices:

- `toolRuntime.type` describes where built-in tools and runtime-placed MCP
  servers execute.
- `agentPlacement: 'host'` means the host agent uses that tool runtime through
  projection.
- `agentPlacement: 'container'` means the child lace-agent process itself runs
  inside the container and constructs its own local tool runtime there.

## Design Decision

### Recommended: Runtime Capabilities

Add one runtime abstraction under `packages/agent/src/tools/runtime/`.

```typescript
export type ToolRuntimeKind = 'local' | 'workspace' | 'container';

export interface RuntimePath {
  original: string;
  runtimePath: string;
  hostPath?: string;
  displayPath: string;
}

export interface ToolRuntime {
  readonly id: string;
  readonly kind: ToolRuntimeKind;
  readonly cwd: string;
  readonly label: string;
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;
}
```

Capability interfaces should be small and mechanical:

```typescript
export interface RuntimePathService {
  resolve(inputPath: string): Promise<RuntimePath>;
  canonicalKey(path: RuntimePath): string;
}

export interface RuntimeFileSystem {
  stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }>;
  readTextFile(path: RuntimePath): Promise<string>;
  writeTextFile(path: RuntimePath, content: string): Promise<void>;
  mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void>;
  readdir(
    path: RuntimePath
  ): Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
}

export interface RuntimeProcessRunner {
  exec(
    command: string[],
    opts?: RuntimeProcessOptions
  ): Promise<RuntimeProcessResult>;
  start(
    command: string[],
    opts?: RuntimeProcessOptions
  ): Promise<RuntimeProcessHandle>;
}

export interface RuntimeNetworkClient {
  fetch(url: string, opts: RuntimeFetchOptions): Promise<RuntimeFetchResult>;
}
```

The important rule: tool implementations should not inspect `kind` for normal
execution. They ask the runtime to resolve paths, read files, write files, run
commands, fetch URLs, or start long-lived stdio processes.

`ToolRuntime` is not the same thing as agent runtime. It does not own model
calls, provider credentials, event storage, traces, or UI job logs. Those remain
host-agent responsibilities even when `ToolRuntime.kind === 'container'`.

### Rejected: Per-Tool Runtime Branches

Adding `if (context.containerRuntime)` to every tool repeats the old
workspace-manager mistake. It makes new tools easy to get wrong and guarantees
that Bash, background jobs, MCP, and file tools drift over time.

### Rejected: Host Path Mapping Only

Mapping container mounts back to host paths is a good optimization, but it is
not a complete container projection. It cannot read container-only files, cannot
observe container `/tmp`, and cannot represent container networking. It would
fail the basic invariant that all tools see the same runtime.

## Runtime Implementations

### `HostToolRuntime`

Used for local sessions. It wraps current behavior:

- `paths.resolve()` resolves relative paths against the host cwd.
- `fs` uses `fs/promises`.
- `process` uses `child_process.spawn` / `execFile`.
- `network.fetch()` uses the current Node fetch implementation.

### `WorkspaceToolRuntime`

Used for host-side workspace clones. It replaces `workspaceInfo` and
`resolveWorkspacePath()`:

- It has `projectRoot`, `workspaceRoot`, and `cwd`.
- Absolute paths under `projectRoot` map into `workspaceRoot`.
- Relative paths resolve under `workspaceRoot`.
- Attempts to escape the workspace fail before touching the filesystem.
- `displayPath` preserves the user's project coordinate instead of leaking the
  clone path when possible.

This is still host execution. Bash and `rg` run on the host, but in the
workspace root. That matches the existing "workspace runtime" semantics without
special cases in individual tools.

This is not a sandbox. Runtime path APIs should enforce workspace containment,
but host process execution can still access host absolute paths unless and until
it is backed by a container or another real isolation boundary.

### `ProjectedContainerToolRuntime`

Used when the agent process stays on the host but tools target a container.

It is backed by `ContainerManager` plus the materialized `ContainerSpec`:

- `process.exec()` and `process.start()` call `ContainerManager.execStream()` or
  an added captured `exec()` wrapper.
- Relative paths resolve against the container cwd.
- Absolute paths are container paths.
- If a runtime path is under a declared mount, `paths.resolve()` may include a
  `hostPath` so filesystem operations can use host I/O as a fast path.
- If no `hostPath` exists, filesystem and network operations go through a
  generic in-container helper.

The helper should be one reusable program, not one shell snippet per tool. It
must not require the full Lace source tree, Lace dist, session directory, or
provider credentials in the container. Acceptable delivery options:

- copy a small helper artifact into a runtime temp path when the container is
  materialized;
- bind-mount that small helper artifact read-only; or
- use an image-provided helper path for images that choose to bake it in.

The descriptor should record the chosen helper strategy and container path so
background jobs and resumed sessions rebuild the same runtime. If the projected
container lacks the helper's interpreter/runtime, Lace should fail clearly when
a helper-backed operation is needed. Host-mount fast paths can still work
without the helper.

Example helper path:

```text
/tmp/lace-runtime-helper/runtime-helper.js
```

The helper reads newline-delimited JSON requests on stdin and returns JSON
responses. Initial operations:

- `stat`
- `readTextFile`
- `writeTextFile`
- `mkdir`
- `readdir`
- `realpath`
- `fetch`

This avoids shell quoting bugs and supports container-local files that are not
bind-mounted to the host. Host-mapped files remain a performance optimization,
not a correctness requirement.

V1 can require projected-container personas/images to provide enough runtime for
the helper. That is still materially smaller than requiring a full lace-agent
installation and provider credentials inside the container.

## ToolContext Changes

Replace the projection-specific fields with a runtime binding:

```typescript
export interface ToolContext {
  signal: AbortSignal;
  runtime: ToolRuntime;
  toolTempRoot?: string;
  toolTempDir?: string;
  threadId?: string;
  projectId?: string;
  processEnv?: NodeJS.ProcessEnv;
  hasFileBeenRead?: (path: RuntimePath) => boolean;
  markFileRead?: (path: RuntimePath) => void;
  jobManager?: JobManager;
  turnId?: string;
  turnSeq?: number;
}
```

Keep `workingDirectory` temporarily only during migration. New code should use
`context.runtime.cwd`.

`Tool.resolveWorkspacePath()` should be deprecated and then deleted after file
tools move to `context.runtime.paths.resolve()`.

## Built-In Tool Migration

| Tool                                  | Runtime behavior                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bash`                                | Use `runtime.process.start(['/bin/bash', '-c', command], { cwd: runtime.cwd, env })`. Continue storing stdout/stderr/combined files in host `toolTempDir`.                                                                                             |
| background `bash`                     | Extend shell jobs with a serialized runtime binding and run through `runtime.process.start()` instead of host `spawn(..., { shell: true })`.                                                                                                           |
| `file_read`                           | Use `runtime.paths.resolve(path)`, then `runtime.fs.readTextFile()`. Return `displayPath` in metadata. Mark the canonical runtime path as read.                                                                                                        |
| `file_write`                          | Resolve through runtime paths. Enforce read-before-write against canonical runtime paths. Write through `runtime.fs.writeTextFile()`.                                                                                                                  |
| `file_edit`                           | Read and write through `runtime.fs`. Diff display stays unchanged except paths use `displayPath`.                                                                                                                                                      |
| `file_find`                           | Use `runtime.fs.readdir/stat` recursively. For container runtime this works through host mount fast path or the helper.                                                                                                                                |
| `ripgrep_search`                      | Run `rg` through `runtime.process.exec()` in the runtime cwd. If `rg` is absent, report that it is missing in the projected runtime.                                                                                                                   |
| `url_fetch`                           | Use `runtime.network.fetch()`. For projected containers this runs through the helper so `localhost`, DNS, and network policy match the container.                                                                                                      |
| `delegate`                            | Inherit the parent's runtime binding by default. Existing personas that declare "run the child agent inside the container" keep using `spawnSubagent()`; projected personas can instead spawn a host child agent with the inherited projected runtime. |
| `job_output`, `jobs_list`, `job_kill` | Stay agent/session-local. They manage Lace job records, not the projected runtime filesystem. `job_kill` must terminate either a host process or runtime process handle.                                                                               |
| `todo_read`, `todo_write`             | Stay session-local. They are handled by `ConversationRunner`, not `ToolExecutor`.                                                                                                                                                                      |
| `use_skill`                           | Load project skill directories through the runtime path service when the configured skill directory is inside the projected workspace. Global/user skill directories stay host-side.                                                                   |

Project skill loading is part of runtime projection because the host agent
builds the system prompt and serves `use_skill`. If a projected container owns
project-local skills that are not host-mounted, the skill registry needs a
runtime-backed read path for those project skill directories. User/global skills
remain host-side because they are part of the host agent environment.

## Runtime Selection

Do not let individual tools infer runtime from persona config. Build one runtime
binding when the session or job starts.

Recommended descriptors:

```typescript
export type RuntimeBindingSchemaVersion = 1;

export type RuntimeSecretNamespace = 'session' | 'project' | 'host-service';

export interface RuntimeSecretReference {
  namespace: RuntimeSecretNamespace;
  name: string;
}

export interface RuntimeBindingIdentity {
  runtimeId: string;
}

export type ToolRuntimeDescriptor =
  | {
      type: 'local';
      cwd: string;
    }
  | {
      type: 'workspace';
      projectRoot: string;
      workspaceRoot: string;
      cwd: string;
    }
  | {
      type: 'container';
      spec: {
        name: string;
        containerId?: string;
        image: string;
        workingDirectory: string;
        mounts: Array<{
          hostPath: string;
          containerPath: string;
          readonly: boolean;
        }>;
        // Non-secret literals only. Secret values must use secretEnv.
        env?: Record<string, string>;
        secretEnv?: Record<string, RuntimeSecretReference>;
        ports?: Array<{ host: number; container: number }>;
        restartPolicy?: 'unless-stopped';
      };
      cwd: string;
      helper?: {
        mode: 'copy' | 'mount' | 'image';
        hostPath?: string;
        containerPath: string;
        command: string[];
      };
    };

export interface RuntimeExecutionBinding {
  schemaVersion: RuntimeBindingSchemaVersion;
  identity: RuntimeBindingIdentity;
  toolRuntime: ToolRuntimeDescriptor;
  agentPlacement: 'host' | 'container';
}
```

`agentPlacement` is orchestration metadata carried alongside the tool runtime
descriptor. It is deliberately not a field on `ToolRuntimeDescriptor`:

- `agentPlacement: 'container'` is today's container persona behavior. The child
  lace-agent runs inside the container and constructs its own local
  `ToolRuntime` there. The host does not project tools into the container for
  that child.
- `agentPlacement: 'host'` is the new projected behavior. The agent runs on the
  host, but its tools target the container.

The session state should persist enough of this binding for background jobs,
delegate resumes, and MCP server reconciliation to rebuild the same runtime and
agent-placement decision after a reload.

For container runtimes, "enough" means a full materialization descriptor or a
stable source reference that deterministically rebuilds the same
`ContainerSpec`. Do not rely on `ContainerManager`'s in-memory spec cache after
process restart.

### Durable Storage Contract

The binding is host-side session/job state. It is not part of the prompt, model
trace, or projected container filesystem.

- Session-level binding lives at `state.config.runtimeBinding` in session
  `state.json`, alongside existing persisted session configuration such as
  connection/model, environment, and MCP server config.
- `meta.json` should keep only list/resume metadata such as `sessionId`,
  `workDir`, and creation time. Do not put full runtime descriptors there; it is
  more likely to be surfaced in lightweight session listings.
- Async job creation must copy the active binding into
  `job_started.data.runtimeBinding` for jobs that need runtime rehydration. The
  in-memory `JobState.runtimeBinding` can cache the parsed binding, but
  `events.jsonl` is the source of truth after restart.
- Delegate jobs inherit the parent binding unless the delegate persona
  explicitly chooses lace-in-container placement. Resumed delegates use the
  binding recorded with their original job/session, not the current caller's
  binding.
- Runtime-placed MCP reconciliation reads the active session binding plus the
  persisted MCP config. Connection state remains in memory and must be rebuilt
  from those durable inputs after restart.

Bindings are schema-versioned. Unknown future `schemaVersion` values fail
resume/startup clearly instead of being treated as v1.

### Descriptor Security

Persisted runtime descriptors must not contain provider credentials or raw
secret values. Credentials used by the host agent stay host-side. Credentials
intentionally exposed to runtime-placed tools or MCP servers must be explicit
tool-runtime configuration and should be represented as secret references in
durable state, not plaintext values.

The only literal environment variables allowed in a persisted descriptor are
non-secret values. Any field that can contain host paths, mount declarations,
container names, helper commands, or secret references should be treated as
sensitive operational metadata:

- it may be stored in session/job state when required for runtime rehydration;
- it should be redacted from model-visible output, UI summaries, traces, and
  error messages unless the field is already part of an intentional display
  path; and
- it must never include host provider credentials, Lace session storage, trace
  directories, or provider config files by default.

Secret references are host-resolved. Tools, MCP adapters, and helper processes
receive resolved environment values only after the host runtime-binding layer
has authorized and resolved the reference for that specific runtime/server.
Individual tools must not read the host secret store directly.

Secret reference namespaces are not LLM provider credential namespaces. A
runtime secret reference cannot point at provider credentials selected by
`connectionId`, provider config files, or cached model-client tokens. Runtime
secret namespaces are limited to explicit session/project stores and
host-service secrets that were deliberately allowed for that MCP server.

The host runtime-binding layer owns secret authorization. Concretely, a
`RuntimeSecretResolver` or equivalent host component validates that a
`RuntimeSecretReference` is allowed for the active session, project, runtime
binding, and MCP server before returning a value. Runtime implementations and
tool implementations receive resolved env maps; they do not make authorization
decisions.

`RuntimeSecretReference` values are redacted as metadata. Model-visible output,
ordinary UI summaries, and non-debug traces should show at most that a secret
reference existed, not its namespace/name pair. Structured debug logs may
include redacted reference identifiers only when the log sink is host-side and
access is restricted like other agent operational logs; raw secret values are
never logged.

If a referenced secret is missing, unauthorized for the target runtime/server,
or fails resolution, runtime materialization or MCP server startup fails before
the tool process is launched.

Secret references are reauthorized against current host policy whenever a
runtime, background job, delegate job, or MCP server is rehydrated after a
restart. V1 does not persist captured secret grants. If a secret was valid when
the job started but is revoked before rehydration, the resumed unit fails with a
redacted "secret unavailable or unauthorized" runtime error instead of retaining
the old access.

Per-unit behavior:

- Session resume fails if the session runtime binding requires a secret that is
  currently missing or unauthorized. No projected process should be left running
  after the failure.
- Background bash job rehydration marks only that job failed, records a redacted
  job error, and does not retry automatically in v1.
- Delegate job rehydration follows the original delegate binding. If a required
  secret is unavailable, the delegate job fails before spawning or reconnecting
  a child agent.
- Runtime-placed MCP startup marks that server failed and closes any partial SDK
  client, transport, or runtime process handle. It retries only after explicit
  config/session reconciliation, not in a tight loop.

Model-visible output should only see these failures when the user asks a tool to
inspect the affected job/server/session. Host operational logs may include the
runtime id and affected unit id with redacted secret references.

Denied secret resolution should be written to host-side operational logs with
the runtime id, server/job id when present, and a redacted secret reference. Raw
secret values are never logged; ordinary model-visible tool output only receives
the redacted runtime error. Those operational logs are host-owned agent logs;
projected containers do not receive them, and they should follow the same access
controls and retention policy as existing host trace/job diagnostics. If that
policy is weaker than provider credential logs, the implementation plan must
tighten it before adding denied-secret logging.

Configuration should set `agentPlacement` explicitly when constructing the
binding. Current persona-container behavior maps to
`agentPlacement: 'container'`. New projected-container behavior must request
`agentPlacement: 'host'`; do not infer projection from
`toolRuntime.type: 'container'` alone.

`RuntimeExecutionBinding` should be part of the session/job contract, not a
field that each tool independently reconstructs. `session/new`,
`session/resume`, background job creation, and delegate job creation all need
access to the active binding.

## Compatibility And Defaulting

Existing state should keep working when it has enough information to do so, but
runtime projection should not guess silently.

This spec defines supported compatibility behavior for v0 state with no runtime
binding and v1 `RuntimeExecutionBinding` state. Approval of this spec is
approval for those compatibility/defaulting rules. Any additional backward
compatibility path discovered during implementation must be called out in the
implementation plan before code is written.

| Existing durable state                         | Resume/default behavior                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session/job has no runtime binding             | Default to v1 local host binding using the existing session `meta.workDir` as `cwd`.                                                                              |
| Session has complete workspace mapping         | Build a v1 workspace binding when `projectRoot`, `workspaceRoot`, and `cwd` are all present and valid.                                                            |
| Session has partial workspace mapping          | Resume as local only if that matches the old behavior for that session. Otherwise fail with a clear error naming the missing workspace fields.                    |
| Persona/job has existing container-agent state | Map to `agentPlacement: 'container'`. The child lace-agent runs inside the container and constructs its own local runtime from that process environment.          |
| Projected-container session/job has v1 binding | Validate schema version, descriptor shape, helper config, mounts, secret references, and MCP placement before materializing or reconnecting to runtime processes. |
| Binding has unknown `schemaVersion`            | Fail resume/startup with an unsupported runtime binding version error.                                                                                            |

Concrete examples:

- An old local session with only `meta.workDir: "/repo"` resumes as a v1 local
  binding whose id follows the legacy uniqueness rule in
  [Runtime Identity And Concurrency](#runtime-identity-and-concurrency).
- An old workspace session that has `projectRoot`, `workspaceRoot`, and `cwd`
  resumes as `WorkspaceToolRuntime`.
- An old workspace session with `workspaceRoot` but no original project root
  fails if any persisted tool/job state depends on project-coordinate display or
  containment checks.
- An old delegate persona with `personaContainerRuntime` remains
  lace-in-container; the host does not infer projected tool runtime just because
  a container exists.
- A new projected-container session must explicitly persist
  `agentPlacement: "host"` and `toolRuntime.type: "container"`.

Missing MCP `placement` fields should be defaulted by config source, not by
inspecting whether the active runtime is a container:

- session/persona/project MCP defaults to `toolRuntime`;
- user/global MCP defaults to `host`; and
- HTTP/SSE MCP with omitted placement defaults to `host` in v1 because
  runtime-placed HTTP/SSE is unsupported.

## MCP Servers

### Problem

Current MCP servers are always host child processes:

```typescript
new StdioClientTransport({
  command: config.command,
  args: config.args,
  env: config.env,
  cwd: config.cwd,
});
```

For projected containers, that is wrong for filesystem-sensitive MCP servers.
They would see host paths while built-in tools see container paths.

### Answer

Add MCP placement and make stdio MCP use the same runtime process capability as
built-in tools.

The core rule is that built-in tools and runtime-placed stdio MCP servers share
the same `ToolRuntime`. Host-service MCP servers stay host-side by explicit
placement.

Recommended config shape:

```typescript
export type McpPlacement = 'toolRuntime' | 'host';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  // Non-secret literals only. Secret values must use secretEnv.
  env?: Record<string, string>;
  secretEnv?: Record<string, RuntimeSecretReference>;
  transport?: 'stdio' | 'sse' | 'http';
  enabled: boolean;
  tools: Record<string, ToolPolicy>;
  placement?: McpPlacement;
}
```

Semantics:

- `placement: 'toolRuntime'`: start the MCP server in the active `ToolRuntime`.
  For projected containers, this means `container exec` into the same container,
  with cwd set to the runtime cwd.
- `placement: 'host'`: start the MCP server as a host child process with host
  cwd/env. Use this for host service integrations that depend on host
  credentials, host sockets, or macOS apps.
- If `placement` is absent, session/persona/project MCP should default to
  `toolRuntime` because that is least surprising for tools that interact with
  files. Global user MCP can default to `host` if/when global config is revived
  as a first-class path. In local and workspace runtimes, `toolRuntime` and
  `host` both execute on the host; the distinction only matters once the tool
  runtime is projected into a container or future remote target.

MCP environment follows the same security rule as runtime descriptors: persisted
config can contain non-secret literals and secret references, but not raw secret
values. A runtime-placed MCP server only receives credentials that were
explicitly configured for that runtime/server. Host agent provider credentials
are not inherited automatically.

Implementation detail: write a `RuntimeStdioClientTransport` implementing the
MCP SDK `Transport` interface over `runtime.process.start()` streams. The SDK
transport interface only needs `start()`, `send()`, `close()`, `onmessage`,
`onerror`, and `onclose`; it does not require `StdioClientTransport`.

`MCPServerManager.startServer()` should accept:

```typescript
{
  config: MCPServerConfig;
  runtime: ToolRuntime;
  hostCwd: string;
}
```

Then it chooses:

- host placement -> existing `StdioClientTransport`
- toolRuntime placement -> `RuntimeStdioClientTransport`

MCP discovery and tool calls stay unchanged after the client is connected.
`MCPToolAdapter` does not need to know where the server process runs.

The server manager must include placement and runtime identity in
reconciliation. Today it compares command, args, env, enabled, and tools only.
Runtime placement requires at least these additional rules:

- config equivalence includes `transport`, `placement`, and effective cwd;
- runtime-placed server connections are scoped to the active session/runtime,
  not just `serverId`;
- switching sessions stops or restarts runtime-placed servers when the runtime
  id changes; and
- closing a runtime-placed server closes the SDK client and kills the underlying
  runtime process handle.

The user-facing MCP server id can remain `serverId`, but the internal connection
key should include session/runtime placement data so a host server and a
runtime-placed server with the same user-facing name cannot alias.

`placement` also needs to be added to the protocol/config schemas that carry MCP
servers into sessions. Strict schemas must reject neither the new field nor the
intended defaulting behavior.

MCP validation happens at two boundaries:

- config load/session creation validates schema shape, defaults missing
  placement by config source, rejects unknown placement values, and rejects raw
  secret values where `secretEnv` is required; and
- server start/reconciliation validates the active runtime binding, resolves
  `secretEnv`, rejects unsupported transport/placement combinations, and fails
  before launch if a secret is missing or unauthorized.

### HTTP/SSE MCP

The protocol schema currently accepts `transport: 'stdio' | 'sse' | 'http'`, but
`MCPServerManager` only implements stdio process spawning. This spec should not
pretend otherwise.

For v1 projection:

- stdio MCP supports `host` and `toolRuntime` placement.
- HTTP/SSE MCP remains host URL-based until a real HTTP/SSE client transport is
  implemented.
- If a config requests `transport: 'http' | 'sse'` with
  `placement: 'toolRuntime'`, fail clearly instead of silently using host
  networking.

## Files Read Tracking

Read-before-write must track canonical runtime paths, not host clone paths.

Add a small file access tracker around runtime paths:

```typescript
interface FileAccessTracker {
  markRead(path: RuntimePath): void;
  hasRead(path: RuntimePath): boolean;
}
```

Canonical key:

- local: normalized host absolute path
- workspace: normalized workspace runtime path, with project/display mapping
  preserved separately
- container: normalized container absolute path plus runtime id

This prevents a projected container write from being authorized because a
different host path happened to be read earlier.

The runner should stop inferring reads from raw `file_read` inputs after the
tool returns. File tools should mark the canonical runtime path as read after a
successful runtime-backed read, and write/edit tools should check the same
canonical key.

## Runtime Identity And Concurrency

Runtime identity is part of the behavioral contract, not an implementation
detail. Two sessions may share the same container image or materialized spec but
must not accidentally share mutable runtime state.

- Each materialized runtime gets a stable `runtime.id` for the lifetime of the
  session/job binding. For containers, that id is included in canonical file
  access keys.
- `runtime.id` is a logical binding id, not necessarily the Docker/container
  process id. It is generated when the session or job binding is created and is
  persisted with that binding.
- New local, workspace, and container bindings should use an opaque generated id
  such as a UUID/ULID with a `rt_` prefix. Do not derive ids from filesystem
  paths. Legacy no-binding defaults may use deterministic ids such as
  `legacy:<scope>:<sessionId>[:<jobId>]:<fingerprint>` because there is no
  persisted id to recover.
- Legacy deterministic ids must be unique per binding scope. `scope` is
  `session`, `job`, or `mcp`; `jobId` is present for job-scoped bindings; and
  `fingerprint` is the first 16 hex characters of SHA-256 over canonical JSON
  containing the defaulted descriptor fields that affect semantics. Canonical
  JSON sorts object keys, uses normalized absolute paths with `/` separators,
  preserves case, strips trailing slashes except filesystem roots, and does not
  resolve symlinks.
- The descriptor, not the runtime id alone, defines runtime semantics. On
  resume, Lace validates both the persisted id and descriptor before reusing the
  binding. Container runtimes store the logical runtime id separately from
  `containerId` so a stale container can be rematerialized only when the
  persisted descriptor proves it is the same logical runtime.
- Container descriptor semantic identity includes image, working directory,
  runtime cwd, container mount paths and readonly flags, literal env values,
  secret reference identities, helper mode/container path/command, and container
  port declarations. Operational details such as `containerId`, copied helper
  host path, and host-assigned port numbers may change during rematerialization
  only when the semantic identity is unchanged.
- If rematerialization would change the runtime semantics, Lace must fail resume
  instead of reusing the old runtime id for a different target.
- Runtime-placed MCP connection keys include server id, transport, placement,
  effective cwd, and runtime id. A host server and runtime-placed server with
  the same user-facing name must not alias.
- Background process handles are scoped to the session/job runtime that created
  them. Resuming a job must rehydrate the runtime before reconnecting to or
  managing the process handle.
- Host temp files, streamed output logs, and tool artifacts remain per session
  or per job even when multiple sessions target the same container image.
- Runtime helpers are addressed through the active runtime binding. A helper
  copied or mounted for one materialized runtime should not be assumed valid for
  another runtime unless the descriptor says so explicitly.

## Temp Files And Output Logs

Tool temp output files stay host-side under the session directory:

- Bash stdout/stderr/combined files are host files populated from runtime
  streams.
- Job output files are host files populated from runtime streams.
- Durable events, trace artifacts, checkpoints, and provider credential files
  stay host-side and are never mounted into a projected container by default.
- `url_fetch` large-response files should stay host-side for UI access. When
  fetching inside a container, stream the response bytes back to the host and
  write the temp file there.

This avoids requiring every container to mount Lace's session storage.

## Failure Semantics

Projection failures should be explicit and should not silently fall back to host
execution.

- If a persisted container id is stale, Lace should inspect or rematerialize the
  runtime from the persisted descriptor when possible. If it cannot, session or
  job resume fails with a clear runtime-rehydration error.
- If a declared mount is missing or cannot be established during
  materialization, runtime creation fails before tools run. If a path simply has
  no host mount fast path, helper-backed filesystem operations may still use the
  container path.
- If the helper or its interpreter/runtime is missing, host-mount fast-path
  operations may continue, but helper-backed operations fail with an error that
  identifies the missing helper capability.
- If a referenced runtime or MCP secret is missing or unauthorized, startup for
  that runtime/server fails before launching any projected process. The error
  names the config field and redacted reference, not the secret value.
- If a runtime process exits, crashes, or is killed, the tool/job result records
  the exit status or signal and flushes available stdout/stderr into host-side
  logs.
- If descriptor rehydration fails for a background job, delegate job, or
  runtime-placed MCP server, that unit fails clearly instead of reconstructing a
  different runtime.
- Runtime binding parse/default/migration errors should be visible at the user
  action that triggered them: `session/resume` returns a resume error, job tools
  report the job rehydration failure, and MCP status/config surfaces mark the
  affected server failed. These errors may also be logged, but logs are not the
  only signal.
- `state.config.runtimeBinding` must be written with the same atomic JSON write
  discipline as other session state. Malformed or unsupported bindings in
  `state.json` fail session resume. Malformed `job_started.data.runtimeBinding`
  fails only the affected job unless the active session itself depends on that
  job during resume.
- Session listing should continue to work when a runtime binding is malformed,
  because `meta.json` and durable event summaries are enough for listing. The
  resume error should include the session id, affected job id when relevant,
  malformed field path, affected file path, and suggested manual action
  ("inspect or remove the malformed runtimeBinding after saving a copy of the
  file"). Automatic repair/export of malformed runtime bindings is not a v1
  goal.
- Unsupported placement combinations, such as HTTP/SSE MCP with
  `placement: 'toolRuntime'` in v1, fail at config/startup time instead of
  silently using host networking.
- Permission errors from the runtime filesystem, process runner, or helper are
  surfaced as runtime errors with display paths; they should not expose redacted
  host paths or secret references.

## Testing Requirements

Use fake runtimes before real containers:

- Unit-test every migrated tool against a fake runtime that records calls. The
  test should fail if a tool reaches directly for `fs`, `child_process`, or
  `process.cwd()` for runtime-sensitive work.
- Test local runtime against current behavior.
- Test workspace runtime path containment and display path behavior.
- Test projected container runtime with a fake `ContainerManager`.
- Test v0/no-binding, workspace, lace-in-container, v1 projected-container, and
  unknown-version resume/defaulting cases.
- Test secret reference validation: raw secret rejection, missing secret
  failure, unauthorized secret failure, current-policy revalidation on resume,
  and redacted debug/error output.
- Test runtime id stability across session/job reload and runtime-placed MCP
  reconciliation.
- Test exact persistence paths: session resume from
  `state.config.runtimeBinding`, job rehydration from
  `job_started.data.runtimeBinding`, and malformed binding failures that do not
  break session listing.
- Test unsupported MCP transport/placement failure before process launch.
- Test stale container handling for both successful rematerialization and clear
  resume failure.
- Add one gated Docker integration smoke:
  1. materialize a container,
  2. `bash` writes a file under container `/tmp`,
  3. `file_read` reads the same `/tmp` path,
  4. `ripgrep_search` finds content in the container cwd,
  5. `url_fetch(http://127.0.0.1:...)` observes the container network view.
- Add one stdio MCP smoke with a tiny MCP server that reports `pwd` and reads a
  file. Run it with `placement: 'toolRuntime'` and assert it sees the projected
  runtime cwd.
- Add background bash coverage using the same runtime binding as sync bash.
- Add a helper-delivery smoke that proves a projected container can perform a
  helper-backed read of a container-local file without the full Lace dist or
  provider credentials mounted into the container.

## Implementation Plan Constraints

This spec intentionally does not define the rollout sequence or PR boundaries.
After the spec is approved, the implementation plan should decompose the work
into small, reviewable changes. No implementation should begin until that plan
exists and has been approved. That plan must preserve these constraints:

Required implementation-plan sections:

- persisted schema paths and type changes, including
  `state.config.runtimeBinding`, `job_started.data.runtimeBinding`, and
  `JobState.runtimeBinding`;
- migration/defaulting for no-binding sessions, workspace sessions,
  lace-in-container personas, projected-container bindings, and unsupported
  schema versions;
- runtime binding validation order, including secret authorization and MCP
  placement validation;
- MCP reconciliation and connection-key changes;
- fake-runtime test boundaries for each migrated built-in tool group;
- Docker/helper smoke coverage for projected container correctness;
- rollback/error behavior for malformed state, stale containers, missing helper,
  missing secrets, and unsupported transports.

Required stage order:

1. Schema/types and durable-path additions with no runtime behavior change.
2. Migration/defaulting plus structural resume validation for v0/no-binding and
   v1 bindings. Structural validation must not start any runtime process.
3. Runtime binding construction, runtime id generation, secret resolver
   authorization, and the checkpoint that no projected runtime process can start
   before current-policy authorization succeeds.
4. Built-in tool migration in this order: read-only filesystem/introspection,
   simple write/edit operations, process/search tools, then network fetch.
5. Background job and delegate rehydration through persisted bindings.
6. MCP schema/defaulting while preserving existing host-placed behavior.
7. MCP reconciliation-key changes while preserving existing host-placed
   behavior.
8. Runtime-placed stdio MCP transport plus lifecycle cleanup.
9. Projected-container helper delivery and Docker/helper smoke coverage.
10. Removal of legacy `workspaceInfo` and `resolveWorkspacePath()` after all
    consumers have moved.

- Start from behavior-preserving runtime plumbing before changing tool
  semantics.
- Define descriptor versioning, compatibility defaults, and secret-redaction
  rules before persisted sessions, jobs, delegates, or MCP reconciliation depend
  on runtime descriptors.
- Do not migrate background processes, delegate jobs, or runtime-placed MCP
  servers before the runtime binding is durable enough to rehydrate after a
  process restart.
- Prove helper delivery and a helper-backed container-local file operation
  before claiming projected container filesystem correctness.
- Migrate built-in tools in small groups with fake-runtime coverage that catches
  direct `fs`, `child_process`, and `process.cwd()` use for runtime-sensitive
  work.
- Add MCP schema/defaulting and connection-key behavior before enabling
  runtime-placed stdio MCP servers.
- Preserve existing lace-in-container persona behavior throughout the migration;
  projected-host behavior should be added as an explicit new binding, not
  inferred from container presence.
- Delete `workspaceInfo` and `resolveWorkspacePath()` only after all consumers
  have moved to `ToolRuntime` capabilities.

## Risks

- Persisted descriptors can leak secrets or host operational details if env,
  mount, helper, and path fields are not redacted consistently.
- The in-container helper becomes a contract. Keep it intentionally small and
  covered by tests.
- Runtime path identity can regress read-before-write protections. Use canonical
  runtime paths consistently from the first file-tool migration.
- Runtime binding migration can break old sessions/jobs if missing descriptors
  and missing MCP placement fields do not have explicit compatibility behavior.
- MCP servers are long-lived. `MCPServerManager` must stop runtime-placed
  servers on session switch and kill their runtime process handles during
  shutdown.
- MCP reconciliation keys will be more specific after runtime placement. Keep
  `runtime.id` stable across resume and restart only when config/runtime
  semantics are unchanged so reconciliation does not churn healthy server
  processes.
- Container runtime rehydration after agent restart is still only partly solved
  by the current container manager. Projected runtime descriptors should include
  enough container/spec identity to inspect or rematerialize cleanly.
- Some MCP servers need host credentials, while filesystem MCPs need runtime
  placement. The `placement` field is necessary; a single global default is not
  enough.
- The runtime helper is a deployment contract. Keep it small, explicit, and
  separate from Lace agent/provider runtime so projected containers do not
  become accidental Lace deployments.

## Acceptance Criteria

- Every built-in tool either uses `ToolRuntime` capabilities or is explicitly
  session-local.
- No built-in tool except runtime implementations directly uses
  runtime-sensitive `fs`, `child_process`, or `process.cwd()`.
- Sync Bash and background Bash execute in the same runtime.
- File tools can read and write both mounted workspace files and container-local
  files in projected container mode.
- `ripgrep_search` and `url_fetch` observe the projected runtime, not the host.
- Stdio MCP servers can run in either host placement or tool-runtime placement.
- Projected container MCP tools see the same cwd and filesystem as built-in
  projected tools.
- Existing lace-in-container subagents continue to work.
- Projected-container mode does not require the full Lace codebase, Lace session
  storage, traces, or provider credentials to be present in the container.
- Host-side traces, durable events, job logs, and provider credentials remain
  available without extracting artifacts from the container.
- Persisted runtime descriptors and MCP configs do not store raw secret values.
- Existing sessions/jobs without runtime descriptors have explicit defaulting or
  fail with clear resume errors.
- Runtime-placed MCP servers are keyed by runtime identity and cannot alias host
  servers or other sessions with the same user-facing server id.
- Projection failures do not silently fall back to host execution.
