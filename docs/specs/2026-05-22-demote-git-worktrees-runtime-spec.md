# Spec - Demote Git Worktrees From Tool Runtime

**Status:** Draft for review. **Date:** 2026-05-22. **Related:**
`docs/specs/2026-05-18-tool-runtime-projection-spec.md`.

## Spec Boundary

This document defines a revision to the projected tool runtime architecture: git
worktrees must stop being a first-class runtime/session concept. This is not the
implementation plan. Once this spec is approved, we will write a separate
implementation plan that decomposes the work into small, reviewable changes.

Implementation must not start from this document alone. The implementation plan
is the gate that defines task order, review boundaries, and verification for
each change.

## Summary

Projected runtime work should care about where tools execute, not how a working
directory was created. A directory may come from a normal checkout, a git
worktree, a temporary clone, a bind mount, or a container mount. Those are
workflow concerns. They should not leak into `ToolRuntime`, session persistence,
MCP placement, job rehydration, or path identity.

The runtime model should be:

- host tools in a host directory;
- optionally bounded host tools in a host directory with filesystem containment;
- projected container tools in a materialized container; and
- lace-in-container agents as a separate agent-placement mode.

Git worktree lifecycle can remain available as a higher-level workflow helper,
but it must produce an ordinary directory path before a session starts. After
that point, the projected runtime system treats the path as a directory, not as
a git worktree.

## Problem

The existing projected runtime spec includes a `WorkspaceToolRuntime` shaped by
`projectRoot`, `workspaceRoot`, and `cwd`. That shape preserves the old
workspace projection model:

- absolute paths under `projectRoot` map into `workspaceRoot`;
- relative paths resolve under `workspaceRoot`; and
- display paths try to preserve original project coordinates.

That makes git/workspace provenance part of the runtime contract. It also
creates edge cases that are not central to projected tool execution:

- tools must reason about two roots instead of one execution root;
- absolute paths can be valid in more than one coordinate system;
- persisted sessions need enough data to reconstruct old path projection;
- MCP placement inherits the same path ambiguity; and
- host-bounded execution looks like a special git worktree mode instead of a
  generic directory runtime.

The container runtime work already has enough real complexity: image identity,
materialization, mounts, helper delivery, secrets, ports, process aborts,
Apple/Docker differences, MCP placement, and durable job/session persistence.
Git worktree semantics add noise without solving those core runtime problems.

## Goals

- Remove git worktrees from the runtime/session persistence contract.
- Make the active tool runtime describe only the execution environment and cwd.
- Preserve the ability for callers to use git worktrees as a workflow choice.
- Replace `projectRoot` to `workspaceRoot` projection with a simpler directory
  execution model.
- Keep path identity, file access tracking, MCP placement, and job rehydration
  based on runtime identity plus runtime paths.
- Keep host-agent and lace-in-container agent placement distinct.
- Make the revised design easier to explain, validate, and migrate.

## Non-Goals

- Do not remove the user's ability to work from a git worktree.
- Do not implement git worktree creation/removal in this spec.
- Do not make `ToolRuntime` responsible for branch lifecycle, commits, rebases,
  merges, or cleanup.
- Do not change projected container semantics beyond removing worktree-shaped
  assumptions from runtime binding.
- Do not solve general host process sandboxing. A bounded host runtime is a
  filesystem containment contract for Lace file APIs, not a full process
  sandbox.

## Design Decision

Git worktrees are demoted to directory acquisition. A workflow may create a
worktree, then pass its path as the session cwd. The runtime layer never records
that the cwd is a git worktree and never tries to map from an original project
checkout into that worktree.

The runtime abstraction becomes:

```typescript
export type ToolRuntimeKind = 'host' | 'boundedHost' | 'container';
```

The important contract is:

- `kind: 'host'`: tools execute directly in a host cwd.
- `kind: 'boundedHost'`: file APIs are contained to a host root, and processes
  start with cwd inside that root.
- `kind: 'container'`: tools execute through projected container capabilities.

No runtime kind means "git worktree". No runtime descriptor stores
`projectRoot`. No runtime descriptor stores enough git metadata to recreate or
clean up a worktree.

## Runtime Descriptors

### Host Runtime

The host runtime is the default local session model:

```typescript
type HostRuntimeDescriptor = {
  type: 'host';
  cwd: string;
};
```

It has no containment beyond ordinary host OS behavior.

### Bounded Host Runtime

The bounded host runtime replaces `WorkspaceToolRuntime` without carrying
git/worktree semantics:

```typescript
type BoundedHostRuntimeDescriptor = {
  type: 'boundedHost';
  root: string;
  cwd: string;
};
```

Rules:

- `root` is the containment root.
- `cwd` must resolve inside `root`.
- relative paths resolve against `cwd`;
- absolute paths are accepted only when they resolve inside `root`;
- file APIs reject lexical or realpath escapes from `root`; and
- process APIs start inside `root`, but are not a complete sandbox.

There is no automatic mapping from a separate project checkout into `root`. If a
caller wants a worktree, it should set `root` and `cwd` to paths inside that
worktree.

The user-visible path is the path the model used. Lace should not synthesize a
separate "original project" path after the session starts.

### Projected Container Runtime

The projected container descriptor remains materially the same, except it does
not rely on workspace/worktree projection for host paths:

```typescript
type ContainerRuntimeDescriptor = {
  type: 'container';
  spec: {
    name: string;
    containerId?: string;
    requestedImage: string;
    resolvedImageDigest: string;
    imagePlatform: string;
    workingDirectory: string;
    mounts: Array<{
      hostPath: string;
      containerPath: string;
      readonly: boolean;
    }>;
    env?: Record<string, string>;
    secretEnv?: Record<string, RuntimeSecretReference>;
    ports?: Array<{ host: number; container: number }>;
    restartPolicy?: 'unless-stopped';
  };
  cwd: string;
  helper?: RuntimeHelperDescriptor;
};
```

If a mount source is a git worktree, that fact is opaque to the runtime. It is
just a host path mounted into the container.

## Runtime Execution Binding

The persisted binding keeps the existing separation between tool runtime and
agent placement:

```typescript
type RuntimeExecutionBinding = {
  schemaVersion: 1;
  identity: { runtimeId: string };
  agentPlacement: 'host' | 'container';
  toolRuntime:
    | HostRuntimeDescriptor
    | BoundedHostRuntimeDescriptor
    | ContainerRuntimeDescriptor;
};
```

Rules:

- Host-orchestrated sessions accept only `agentPlacement: 'host'`.
- Lace-in-container sessions use `agentPlacement: 'container'` and construct
  local runtime state inside the child agent.
- `toolRuntime.type` never implies `agentPlacement`.
- `runtimeId` is derived from the descriptor content that affects tool behavior,
  not from git metadata.

## Session Semantics

Session creation receives a cwd and, optionally, a runtime binding. If no
binding is supplied, Lace creates a host runtime binding:

```typescript
{
  schemaVersion: 1,
  identity: { runtimeId: "session:<sessionId>:host" },
  agentPlacement: "host",
  toolRuntime: { type: "host", cwd }
}
```

If a caller wants bounded host behavior, it supplies `type: 'boundedHost'` with
`root` and `cwd`. If a caller wants a git worktree, it creates the git worktree
before session creation and passes the worktree path as `root` and `cwd`.

Session load/resume must validate the stored binding before activation. Invalid
or unsupported runtime bindings fail before replacing the active session.

## Path Semantics

Path semantics are runtime-local:

- host runtime paths are host paths;
- bounded host runtime paths are host paths inside `root`;
- container runtime paths are container paths; and
- mounted container paths may include an optional `hostPath` fast path.

The old project-root-to-workspace-root mapping is removed from the runtime
contract. A model-visible absolute path is valid only if it is valid in the
active runtime coordinate system.

This means there is no attempt to make both `/repo/src/a.ts` and
`/tmp/lace/worktrees/sess/src/a.ts` refer to the same logical file. The active
runtime has one coordinate system.

## MCP Placement

MCP placement remains a first-class runtime concern:

- `placement: 'toolRuntime'` starts stdio MCP servers in the active tool
  runtime.
- `placement: 'host'` starts stdio MCP servers on the host.
- HTTP/SSE MCP transports remain host-side in v1.

Removing git worktrees from the runtime model makes MCP placement simpler:
runtime-placed MCP servers see exactly the same cwd and filesystem coordinate
system as built-in process tools.

## Worktree Lifecycle

Worktree lifecycle moves out of the tool runtime layer.

Allowed higher-level APIs may still exist:

- create a git worktree for a user workflow;
- return the created directory path;
- optionally remove the worktree after the workflow completes; and
- optionally expose branch name/status in UI surfaces that are explicitly about
  git workflow.

Those APIs must not be required for runtime binding, session load, MCP
placement, file access tracking, or job rehydration.

The existing `WorktreeManager` should either be removed if unused or moved
behind an explicit workflow boundary. It should not be imported by runtime,
session, MCP, or tool execution code.

## Migration

Persisted runtime bindings should migrate as follows:

| Existing binding                                     | New binding                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `toolRuntime.type: 'local'`                          | `toolRuntime.type: 'host'` with same cwd                                 |
| `toolRuntime.type: 'workspace'` with `workspaceRoot` | `toolRuntime.type: 'boundedHost'` with `root: workspaceRoot`, mapped cwd |
| `toolRuntime.type: 'container'`                      | unchanged except enum naming if needed                                   |

For old workspace bindings:

- If `cwd` was already inside `workspaceRoot`, keep it.
- If `cwd` was inside `projectRoot`, map it once into `workspaceRoot`.
- After migration, discard `projectRoot`; future path resolution does not use
  project-root coordinates.
- If the binding cannot be mapped safely, reject the stored binding before
  session activation with a clear recovery error.

The migration should be one-way for runtime semantics. We should not preserve a
compatibility path where future tools continue accepting project-root paths in a
bounded host runtime.

## Acceptance Criteria

- `ToolRuntime` and runtime descriptors contain no git/worktree fields.
- Session runtime binding persistence does not record `projectRoot`.
- Runtime path resolution has a single coordinate system per runtime.
- Existing projected container behavior continues to work with mounts, helper
  execution, secrets, ports, process aborts, and MCP placement.
- Runtime-placed MCP servers use the same runtime cwd as built-in process tools.
- Host-orchestrated sessions reject `agentPlacement: 'container'`.
- Any remaining `WorktreeManager` usage is outside runtime/session/MCP/tool
  execution paths.
- Tests cover migration from old workspace bindings into bounded host bindings.
- Tests cover rejecting project-root paths after migration when they are outside
  the active bounded root.

## Verification Strategy

The implementation plan should include targeted tests for:

- descriptor schema parsing for `host`, `boundedHost`, and `container`;
- migration from old `local` and `workspace` bindings;
- bounded host path containment and realpath escape rejection;
- session load/resume rejecting unmappable old workspace bindings;
- session new/load/resume rejecting container-agent placement for host sessions;
- MCP `toolRuntime` placement with bounded host and container runtimes; and
- job runtime binding persistence and rehydration without worktree fields.

The plan should also include a grep-based invariant:

```text
runtime/session/MCP/tool execution code must not import WorktreeManager
```

## Open Questions

1. Should the externally visible runtime descriptor use `type: 'host'` or keep
   `type: 'local'` for wire compatibility?
2. Should bounded host runtime be exposed to clients immediately, or should it
   remain an internal migration target until a caller needs it?
3. Should `WorktreeManager` be deleted in this branch if no runtime-independent
   workflow still uses it, or moved to a clearly named git workflow module?
