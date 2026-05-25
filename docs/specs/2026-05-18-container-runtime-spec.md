# Spec — Lace container runtime + persona container projection (kata #49)

**Status:** Ready for worker dispatch (autonomous-PM authorized 2026-05-18).
**Date:** 2026-05-18. **Implements:** kata #49 (and unblocks sen-core katas #5,
#6). **Authorization:** Jesse approved Architecture A, full deletion of dead
workspace code, parallel multi-worker dispatch.

## Motivation

Lace today has three "workspace managers" hiding behind a fake
`IWorkspaceManager` interface — one bookkeeping-only (`LocalWorkspaceManager`),
one git-worktree (`WorktreeWorkspaceManager`), and one worktree+container
(`WorkspaceContainerManager`). The container flavor has no live consumers. The
interface unifies things that aren't actually unified.

Sen-core needs a different concept entirely: **persona containers** — long-lived
containers projected with named host mounts, in which subagent lace-agent
processes run. Personas declare what runtime they want; lace materializes it.

Trying to retrofit persona containers onto the existing workspace abstraction
creates worse code, not better. Decouple at the right layer: a generic
`ContainerManager` over `ContainerRuntime`, with consumers (personas, future
dev-sessions) building specs above it.

## Architecture decisions

### A. Lace-in-container (vs. tool-routing)

Subagents whose persona declares `runtime.type: container` run as lace-agent
processes **inside** the container, spawned via `docker exec -i`. Stdio JSON-RPC
over docker exec stdin/stdout — same shape as today's native subagent spawn,
just with `docker exec` as the launcher. Subagent's filesystem view is the
container's view. No cross-cutting refactor of every fs-touching tool.

Trade: container image must include node + lace dist (mounted or baked).
Acceptable.

### B. Lace delivery to subagent containers — deferred to deployment

Lace's location inside the container (e.g., `/lace/packages/agent/dist/main.js`)
is a fixed convention. **Whether** lace got there via bind-mount (dev) or via
`COPY` in the persona image (deployed) is a docker-compose / Dockerfile concern,
not a lace concern. Lace's `subagent-job` spawn code only knows the path; it
does not toggle modes.

### C. Container ids

All lace-managed containers prefixed `lace-`:

- Persona: `lace-{parentSessionId}-{personaName}`
- (Future dev-session, if anyone resurrects that use case:
  `lace-worktree-{sessionId}`)

The prefix is what `reapOrphans` scans for.

### D. ContainerManager is the single generic abstraction

One class. One responsibility: take a `ContainerSpec`, materialize a container,
cache by name, expose stream/destroy/inspect/reaper. Knows nothing about
personas, worktrees, or sessions. Consumers build specs.

### E. Persona schema: `runtime`, not `workspace`

The word "workspace" was carrying two unrelated concepts. The persona-level
field gets a new name: **`runtime`**. Values: `root | container`. `workspace` as
a term survives only at the session/project level (different layer, different
concept) — not touched in this kata.

### F. Named-mount registry at ent-protocol initialize

Persona authors do not write host paths. They pick from a registry of named
mounts (`scratch`, `knowledge`, `identity`, `persona`) that the embedder
(sen-core) declares at initialize time. The registry pins source path AND
readonly flag. Persona declares only `name → target` mapping. Unknown name =
parse error.

This makes mounts safe by construction: no path traversal, no accidental
writable identity dir, no host-path leakage into personas.

## What gets deleted

Per Jesse's explicit authorization — no live consumers, no back-compat.

### Production (lace)

- `packages/agent/src/workspace/workspace-container-manager.ts` (301 lines)
- `packages/agent/src/workspace/workspace-manager.ts` — `IWorkspaceManager`
  interface + `WorkspaceManagerFactory` + `DEFAULT_WORKSPACE_MODE` +
  `WorkspaceMode` type (105 lines)
- `packages/agent/src/workspace/clone-manager.ts` (160 lines; only consumer was
  WorkspaceContainerManager — verify)
- `packages/agent/src/workspace/local-workspace-manager.ts` (100 lines; verify
  no live consumers after Factory deletion)
- `packages/agent/src/workspace/worktree-workspace-manager.ts` (122 lines;
  verify no live consumers after Factory deletion)
- `packages/agent/src/rpc/handlers/workspace.ts` (63 lines — both
  `ent/workspace/info` and `ent/workspace/create` go)
- `packages/agent/src/tools/types.ts` — drop
  `workspaceManager?: IWorkspaceManager` field on `ToolContext`
- `packages/agent/src/tools/implementations/bash.ts` — drop workspace-routing
  branch (~60 lines around line 86–91 and 547–600); bash returns to native exec
  only
- `packages/agent/src/test-utils/core-test-setup.ts` — drop workspaceManager
  test wiring

### Production (ent-protocol)

- `packages/ent-protocol/src/schemas/methods.ts` — delete `ent/workspace/info`
  and `ent/workspace/create` method schemas (~100 lines around 1616–1700)

### Client fallout

Per Jesse: deletion is acceptable, **don't add anything**. If a client command
references the dead methods, delete it. Stub flows that lose functionality are
OK; do not invent replacements.

### Tests

- `workspace-container-manager.test.ts` (264)
- `workspace.integration.test.ts` (246)
- `workspace-integration.test.ts` (116)
- `workspace-cleanup-validation.test.ts` (105)
- `container-cleanup-validation.test.ts` (176) — verify; may survive if it tests
  `AppleContainerRuntime` directly rather than the dead manager
- `clone-manager.test.ts` (155) — if `clone-manager.ts` is deleted, this goes
  with it
- `local-workspace-manager.test.ts` — only if `local-workspace-manager.ts` is
  deleted
- `worktree-workspace-manager.test.ts` — only if `worktree-workspace-manager.ts`
  is deleted
- `workspace.test.ts` files anywhere referencing the deleted manager

### Survives

- `packages/agent/src/containers/runtime.ts` — `BaseContainerRuntime` stays
- `packages/agent/src/containers/types.ts` — `ContainerRuntime`,
  `ContainerConfig`, `ContainerMount`, `ExecOptions`, `ExecResult` all stay;
  **add `execStream`**
- `packages/agent/src/containers/apple-container.ts` — stays as a
  ContainerRuntime implementation; gets `execStream` added
- `packages/agent/src/workspace/worktree-manager.ts` — `WorktreeManager` is a
  pure git-worktree utility used elsewhere; stays

## New code

### K-49a-0: `ContainerRuntime.execStream` interface addition

Add to `containers/types.ts`:

```typescript
export interface ExecStreamOptions {
  command: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
}

export interface ExecStreamHandle {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): void;
}

export interface ContainerRuntime {
  // ...existing methods...
  execStream(
    containerId: string,
    options: ExecStreamOptions
  ): Promise<ExecStreamHandle>;
}
```

K-49a-0 lands a throwing stub on `AppleContainerRuntime`
(`throw new Error('execStream not yet implemented on AppleContainerRuntime')`)
so the codebase typechecks. Real impls land in K-49a-i (apple) and K-49a-ii
(docker) in parallel.

### K-49a-i: `AppleContainerRuntime.execStream`

Real implementation streaming through `container exec`. Mirror the
apple-container shell-out patterns used for `exec`, but keep child
stdin/stdout/stderr open instead of capturing.

### K-49a-ii: `DockerContainerRuntime`

New file `packages/agent/src/containers/docker-container.ts`. Implements
`ContainerRuntime` using docker CLI (preferred for v1 — fewer dependencies;
dockerode is OK if it materially simplifies streaming).

- `create(config)` →
  `docker create --name lace-{id} -v ... -e ... <image> sleep infinity`
  (long-lived idle container)
- `start(id)` → `docker start <id>`
- `stop(id, timeout?)` → `docker stop -t <s> <id>`
- `remove(id)` → `docker rm -f <id>`
- `exec(id, options)` → `docker exec` (captured)
- `execStream(id, options)` → `docker exec -i` (streamed)
- `inspect(id)` → `docker inspect` → ContainerInfo
- `list()` → `docker ps -a --filter name=lace- --format json`
- `translateToContainer/translateToHost` → inherited from `BaseContainerRuntime`

Tests mirror `apple-container.test.ts`. Integration tests gated on docker
availability (`describe.skipIf(!hasDocker)`).

### K-49b: `ContainerSpec` + generic `ContainerManager`

New files in `packages/agent/src/containers/`:

```typescript
// containers/spec.ts
export interface PortMapping {
  host: number;
  container: number;
}

export interface ContainerSpec {
  name: string; // unique; becomes container id (with 'lace-' prefix)
  image: string;
  workingDirectory: string;
  mounts: ContainerMount[];
  env: Record<string, string>;
  ports?: PortMapping[];
}

export interface ContainerHandle {
  spec: ContainerSpec;
  containerId: string;
  state: ContainerState;
}

export interface ContainerLifecycleHooks {
  beforeCreate?: () => Promise<void>;
  afterDestroy?: () => Promise<void>;
}
```

```typescript
// containers/container-manager.ts
export class ContainerManager {
  constructor(private runtime: ContainerRuntime) {}

  /** Idempotent by spec.name. If already exists and running, returns existing. */
  async materialize(
    spec: ContainerSpec,
    hooks?: ContainerLifecycleHooks
  ): Promise<ContainerHandle>;

  async inspect(specName: string): Promise<ContainerHandle | null>;

  async destroy(
    specName: string,
    hooks?: ContainerLifecycleHooks
  ): Promise<void>;

  async execStream(
    specName: string,
    options: ExecStreamOptions
  ): Promise<ExecStreamHandle>;

  /**
   * Best-effort cleanup. Scans runtime.list() for containers whose name starts with
   * `lace-{idPrefix}` and are not in the provided liveSpecNames set. Destroys them.
   */
  async reapOrphans(
    idPrefix: string,
    liveSpecNames: Set<string>
  ): Promise<{ reaped: string[] }>;
}
```

Tests use a fake `ContainerRuntime` (in-memory). No persona or worktree
knowledge in this code.

### K-49d: Persona `runtime` schema

`packages/agent/src/config/persona-registry.ts` — replace the existing
`workspace: z.enum(['local','worktree','container']).optional()` field with:

```typescript
const runtimeRootSchema = z.object({
  type: z.literal('root'),
});

const portMappingSchema = z.object({
  host: z.number().int().positive(),
  container: z.number().int().positive(),
});

const runtimeContainerSchema = z.object({
  type: z.literal('container'),
  image: z.string().min(1),
  workingDirectory: z.string().min(1),
  mounts: z.record(z.string(), z.string().min(1)),   // mountName → containerTarget
  env: z.record(z.string(), z.string()).optional().default({}),
  ports: z.array(portMappingSchema).optional(),
});

const runtimeSchema = z.discriminatedUnion('type', [runtimeRootSchema, runtimeContainerSchema]);
// On the persona schema:
runtime: runtimeSchema.optional().default({ type: 'root' }),
```

Mount keys must resolve in the registry (K-49d ent-protocol portion below).
Unknown mount name → parse error.

### K-49d: Named-mount registry at ent-protocol initialize

`packages/ent-protocol/src/schemas/initialize.ts` — extend initialize params
with `containerMounts`:

```typescript
containerMounts: z.record(
  z.string().regex(/^[a-z][a-z0-9-]*$/),     // mount name
  z.object({
    hostPath: z.string().min(1),
    readonly: z.boolean(),
  })
).optional().default({}),
```

Lace stores this on agent state. When a persona's container runtime is
materialized (in K-49e), each mount-name key in `runtime.mounts` is resolved
against `containerMounts[name]`:

- `hostPath` from registry → `ContainerMount.source`
- `readonly` from registry → `ContainerMount.readonly`
- `target` from persona's `runtime.mounts[name]` → `ContainerMount.target`

Unknown mount name → spawn fails with a clear error before container
materialize.

### K-49e: Subagent-spawn integration

`packages/agent/src/tools/implementations/delegate.ts` +
`packages/agent/src/jobs/subagent-job.ts`.

When the delegate's parsed persona has `runtime.type === 'container'`:

1. Compute container name: `${parentSessionId}-${personaName}`. Pass to
   `ContainerManager.materialize` (which prefixes `lace-` internally per the
   spec on container IDs).
2. Build `ContainerSpec` from the persona's `runtime` block + the agent's
   `containerMounts` registry. Each `runtime.mounts[name]` resolves to a
   `ContainerMount` via the registry. Unknown name → error before materialize.
3. `materialize` is idempotent by name: if a matching container exists and is
   running, reuse it. (Survives Ada restart since name is stable.)
4. Spawn lace-agent inside via
   `containerManager.execStream(name, { command: ['node', '/lace/packages/agent/dist/main.js', ...] })`.
   Stdio handles plumb into the existing `JsonRpcPeer` + `subagent-job`
   machinery. Replace `spawn(process.execPath, ...)` for the container case.
5. The subagent process is short-lived (one delegate). The CONTAINER persists
   for the next delegate.

Native (non-container) personas continue to spawn via
`spawn(process.execPath, [process.argv[1]], ...)` unchanged.

### K-49f: Reaper on agent startup

In the agent server bootstrap (wherever AgentServerState is initialized — likely
`packages/agent/src/server.ts` or equivalent), after the agent is initialized
but before accepting RPC:

```typescript
const liveSpecs = new Set<string>(); // populated from persisted session state if any
await containerManager.reapOrphans('', liveSpecs);
```

Best-effort. If reaper fails (docker unavailable, etc.), log and continue. Don't
block agent startup.

For v1, `liveSpecs` is empty — every lace-prefixed container on the host gets
reaped at boot. Future: track in-flight session+persona containers in agent
state and pass live names to skip them.

## Out of scope

- Resource limits (cpu/memory) on personas. Image defaults stand.
- Custom networking (egress filters, capability flags). Default docker bridge.
- Persona container restart policies. Containers tear down on parent shutdown.
- Browser persona (kata #6); shell persona (kata #5). Both are sen-core katas
  downstream of #49.
- Dev-session container resurrection. The existing `WorkspaceContainerManager`
  use case is dead and not being replaced by this kata.
- Multi-graduate orchestration. Per-instance separation comes for free via
  parentSessionId.

## Acceptance criteria

- `npm run lint && npm run typecheck && npm test --silent -- --run` all clean on
  a worktree built atop dev with all 8 kata commits merged.
- All deletions land; no dead imports, no orphaned tests.
- `DockerContainerRuntime` integration tests pass on a machine with docker
  (skip-gated where docker missing).
- Smoke (K-49 task #131): a sen-core test persona with `runtime.type: container`
  materializes a container, lace-agent runs inside, persistent scratch dir
  survives across two delegates, readonly mounts reject writes, container reused
  across Ada restart, orphans reaped on next boot.

## Risks

- **K-49c is the riskiest worker pass** — deletion crossing 3 packages with
  cross-file references. Implementer must grep each deletion target for
  references before removing, and run lint+typecheck+test after each batch.
- **K-49e is the riskiest integration** — subagent-job is core. Plumbing stdio
  through `docker exec -i` may have subtle buffering / EOF differences from
  native `spawn`. Smoke is the only real test. Reserve PM bandwidth.
- **Docker availability in CI**. Integration tests for DockerContainerRuntime
  gate on docker presence. Unit tests use mocks.
- **Client fallout from K-49c**. If deleted workspace APIs still have clients,
  delete the clients instead of adding compatibility shims.

## Worker dispatch order

1. **Pre-wave**: K-49a-0 (interface stub). Solo.
2. **Wave 1 (5 parallel)**: K-49a-i, K-49a-ii, K-49b, K-49c, K-49d.
3. **Wave 2 (2 parallel)**: K-49e (depends on a-ii + b + d), K-49f (depends on
   b).
4. **Wave 3**: smoke worker. Solo.
5. **Wave 4**: audit + FF-merge to dev. Solo.

Each worker pass uses `superpowers:subagent-driven-development` (implementer →
spec reviewer → code quality reviewer). PM gates between waves.

## Branch strategy

Each kata gets its own branch off the most-recently-merged kata's head.

- `kata-49a-0` off `dev`
- `kata-49a-i`, `kata-49a-ii`, `kata-49b`, `kata-49c`, `kata-49d` all off
  `kata-49a-0` merged head
- `kata-49e`, `kata-49f` off the Wave-1 merged head (which is dev at that point)
- Smoke runs against the post-merge dev
- Final audit FF-merges everything to `dev`

Branches do not get pushed.

## Cross-repo implications

Zero sen-core work in this kata. After #49 lands on lace dev:

- Sen-core kata #5 (R7 shell subagent) collapses to: add
  `templates/agent-personas/shell.md` with `runtime: { type: container, ... }`,
  seed in bootstrap, mount `/var/run/docker.sock` in `scripts/run-ada.sh`, add
  scenarios. ~2-3h sen-core kata.
- Sen-core kata #6 (R8 browser subagent) similarly small.
- Sen-core must also send `containerMounts` in its `ent/initialize` call (kata
  #5 brief addition).
