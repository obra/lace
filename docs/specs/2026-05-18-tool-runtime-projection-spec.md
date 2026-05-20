# Spec - Tool Runtime Projection For Host-Run Agents

**Status:** Draft for review. **Date:** 2026-05-18. **Related:**
`docs/specs/2026-05-18-container-runtime-spec.md`, kata #49.

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

- `agentPlacement: 'host'` means the host agent uses a projected tool runtime.
- `agentPlacement: 'container'` means the child lace-agent process itself runs
  inside the container.

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

| Tool                                  | Runtime behavior                                                                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash`                                | Use `runtime.process.start(['/bin/bash', '-c', command], { cwd: runtime.cwd, env })`. Continue storing stdout/stderr/combined files in host `toolTempDir`.                                                                                                |
| background `bash`                     | Extend shell jobs with a serialized runtime descriptor and run through `runtime.process.start()` instead of host `spawn(..., { shell: true })`.                                                                                                           |
| `file_read`                           | Use `runtime.paths.resolve(path)`, then `runtime.fs.readTextFile()`. Return `displayPath` in metadata. Mark the canonical runtime path as read.                                                                                                           |
| `file_write`                          | Resolve through runtime paths. Enforce read-before-write against canonical runtime paths. Write through `runtime.fs.writeTextFile()`.                                                                                                                     |
| `file_edit`                           | Read and write through `runtime.fs`. Diff display stays unchanged except paths use `displayPath`.                                                                                                                                                         |
| `file_find`                           | Use `runtime.fs.readdir/stat` recursively. For container runtime this works through host mount fast path or the helper.                                                                                                                                   |
| `ripgrep_search`                      | Run `rg` through `runtime.process.exec()` in the runtime cwd. If `rg` is absent, report that it is missing in the projected runtime.                                                                                                                      |
| `url_fetch`                           | Use `runtime.network.fetch()`. For projected containers this runs through the helper so `localhost`, DNS, and network policy match the container.                                                                                                         |
| `delegate`                            | Inherit the parent's runtime descriptor by default. Existing personas that declare "run the child agent inside the container" keep using `spawnSubagent()`; projected personas can instead spawn a host child agent with the inherited projected runtime. |
| `job_output`, `jobs_list`, `job_kill` | Stay agent/session-local. They manage Lace job records, not the projected runtime filesystem. `job_kill` must terminate either a host process or runtime process handle.                                                                                  |
| `todo_read`, `todo_write`             | Stay session-local. They are handled by `ConversationRunner`, not `ToolExecutor`.                                                                                                                                                                         |
| `use_skill`                           | Load project skill directories through the runtime path service when the configured skill directory is inside the projected workspace. Global/user skill directories stay host-side.                                                                      |

Project skill loading is part of runtime projection because the host agent
builds the system prompt and serves `use_skill`. If a projected container owns
project-local skills that are not host-mounted, the skill registry needs a
runtime-backed read path for those project skill directories. User/global skills
remain host-side because they are part of the host agent environment.

## Runtime Selection

Do not let individual tools infer runtime from persona config. Build one runtime
binding when the session or job starts.

Recommended descriptor:

```typescript
export type ToolRuntimeDescriptor =
  | { type: 'local'; cwd: string }
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
        env?: Record<string, string>;
        ports?: Array<{ host: number; container: number }>;
        restartPolicy?: 'unless-stopped';
      };
      cwd: string;
      agentPlacement: 'host' | 'container';
      helper?: {
        mode: 'copy' | 'mount' | 'image';
        hostPath?: string;
        containerPath: string;
        command: string[];
      };
    };
```

`agentPlacement` is deliberately separate from the tool runtime target:

- `agentPlacement: 'container'` is today's container persona behavior. The child
  lace-agent runs inside the container, so most of this projection machinery is
  not needed inside that child.
- `agentPlacement: 'host'` is the new projected behavior. The agent runs on the
  host, but its tools target the container.

The session state should persist enough of this descriptor for background jobs,
delegate resumes, and MCP server reconciliation to rebuild the same runtime
after a reload.

For container runtimes, "enough" means a full materialization descriptor or a
stable source reference that deterministically rebuilds the same
`ContainerSpec`. Do not rely on `ContainerManager`'s in-memory spec cache after
process restart. The persisted descriptor should not include provider
credentials. Credentials used by the host agent stay host-side; credentials
intentionally exposed to runtime-placed tools or MCP servers must be explicit
tool-runtime configuration.

Configuration should set `agentPlacement` explicitly when constructing the
descriptor. Current persona-container behavior maps to
`agentPlacement: 'container'`. New projected-container behavior must request
`agentPlacement: 'host'`; do not infer projection from
`runtime.type: 'container'` alone.

`ToolRuntimeDescriptor` should be part of the session/job contract, not a field
that each tool independently reconstructs. `session/new`, `session/resume`,
background job creation, and delegate job creation all need access to the active
descriptor.

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

Recommended config shape:

```typescript
export type McpPlacement = 'toolRuntime' | 'host';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
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

## Testing Requirements

Use fake runtimes before real containers:

- Unit-test every migrated tool against a fake runtime that records calls. The
  test should fail if a tool reaches directly for `fs`, `child_process`, or
  `process.cwd()` for runtime-sensitive work.
- Test local runtime against current behavior.
- Test workspace runtime path containment and display path behavior.
- Test projected container runtime with a fake `ContainerManager`.
- Add one gated Docker integration smoke:
  1. materialize a container,
  2. `bash` writes a file under container `/tmp`,
  3. `file_read` reads the same `/tmp` path,
  4. `ripgrep_search` finds content in the container cwd,
  5. `url_fetch(http://127.0.0.1:...)` observes the container network view.
- Add one stdio MCP smoke with a tiny MCP server that reports `pwd` and reads a
  file. Run it with `placement: 'toolRuntime'` and assert it sees the projected
  runtime cwd.
- Add background bash coverage using the same runtime descriptor as sync bash.
- Add a helper-delivery smoke that proves a projected container can perform a
  helper-backed read of a container-local file without the full Lace dist or
  provider credentials mounted into the container.

## Rollout Plan

1. Add `ToolRuntime` interfaces plus `HostToolRuntime`. Wire
   `ConversationRunner` to pass `context.runtime` while keeping current
   `workingDirectory` for migrated code.
2. Move file read/write/edit/find from `resolveWorkspacePath()` to runtime
   `paths` and `fs`.
3. Move sync Bash, background Bash, and `ripgrep_search` to runtime `process`.
4. Persist and pass `ToolRuntimeDescriptor` through session state, background
   job state, and delegate job creation.
5. Add `ProjectedContainerToolRuntime` with mount fast path and runtime helper
   fallback.
6. Move `url_fetch` to runtime `network`.
7. Add MCP placement and `RuntimeStdioClientTransport`.
8. Make delegate jobs inherit runtime descriptors. Preserve existing
   lace-in-container persona behavior and add projected-host behavior as an
   explicit runtime descriptor.
9. Delete `workspaceInfo` and `resolveWorkspacePath()` once all consumers are
   migrated.

## Risks

- The in-container helper becomes a contract. Keep it intentionally small and
  covered by tests.
- Runtime path identity can regress read-before-write protections. Use canonical
  runtime paths consistently from the first file-tool migration.
- MCP servers are long-lived. `MCPServerManager` must stop runtime-placed
  servers on session switch and kill their runtime process handles during
  shutdown.
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
