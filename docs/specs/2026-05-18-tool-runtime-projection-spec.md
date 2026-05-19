# Spec - Tool Runtime Projection For Host-Run Agents

**Status:** Draft for review. **Date:** 2026-05-18. **Related:**
`docs/specs/2026-05-18-container-runtime-spec.md`, kata #49.

## Summary

Lace currently has three related ideas that are not cleanly separated:

- A host/local session, where the agent process and tools both run on the host.
- A workspace session, where host-side file tools can be pointed at a cloned or
  mapped workspace through `ToolContext.workspaceInfo`.
- A persona container runtime, where the subagent lace-agent process itself runs
  inside a long-lived container.

The missing shape is a projected runtime: the lace-agent process can stay on the
host while its tools behave as if they are inside a workspace or container. The
right abstraction is not "if container, branch inside each tool". The right
abstraction is a `ToolRuntime` capability object built once per session/job and
passed through `ToolContext`. Tools call runtime capabilities for filesystem,
process, network, and MCP server execution. Runtime implementations decide
whether that work happens on the host, in a workspace clone, or in a container.

This preserves the existing container-subagent path while adding a clean
host-run agent path for projected containers.

## Current State

### What exists

- `ConversationRunner.executeToolByName()` builds `ToolContext` with
  `workingDirectory`, `toolTempRoot`, `processEnv`, `hasFileBeenRead`, and job
  metadata.
- File tools call `Tool.resolveWorkspacePath()`, which uses optional
  `workspaceInfo` to rewrite project paths into a host clone path.
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
- Do not implement a general remote filesystem protocol beyond what tool
  execution needs.
- Do not add resource limits, network policy, or sandbox policy here.
- Do not make HTTP/SSE MCP transports projected in v1. The current manager is
  stdio-oriented; stdio placement is the critical path.

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
can live in the Lace agent dist as something like:

```text
/lace/packages/agent/dist/runtime-helper.js
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
      specName: string;
      cwd: string;
      mounts: Array<{
        hostPath: string;
        containerPath: string;
        readonly: boolean;
      }>;
      agentPlacement: 'host' | 'container';
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

Configuration should set `agentPlacement` explicitly when constructing the
descriptor. Current persona-container behavior maps to
`agentPlacement: 'container'`. New projected-container behavior must request
`agentPlacement: 'host'`; do not infer projection from
`runtime.type: 'container'` alone.

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

## Temp Files And Output Logs

Tool temp output files stay host-side under the session directory:

- Bash stdout/stderr/combined files are host files populated from runtime
  streams.
- Job output files are host files populated from runtime streams.
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

## Rollout Plan

1. Add `ToolRuntime` interfaces plus `HostToolRuntime`. Wire
   `ConversationRunner` to pass `context.runtime` while keeping current
   `workingDirectory` for migrated code.
2. Move file read/write/edit/find from `resolveWorkspacePath()` to runtime
   `paths` and `fs`.
3. Move sync Bash, background Bash, and `ripgrep_search` to runtime `process`.
4. Add `ProjectedContainerToolRuntime` with mount fast path and runtime helper
   fallback.
5. Move `url_fetch` to runtime `network`.
6. Add MCP placement and `RuntimeStdioClientTransport`.
7. Make delegate jobs inherit runtime descriptors. Preserve existing
   lace-in-container persona behavior and add projected-host behavior as an
   explicit runtime descriptor.
8. Delete `workspaceInfo` and `resolveWorkspacePath()` once all consumers are
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
