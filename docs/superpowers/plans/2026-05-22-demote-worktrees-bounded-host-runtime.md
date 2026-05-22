# Demote Worktrees And Require Bounded Host Runtime Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `local`/`workspace` runtime model with
`host`/`boundedHost`/`container`, make `boundedHost` the default host-session
runtime, migrate old persisted bindings, and remove first-class git worktree
runtime code.

**Architecture:** Keep the existing `ToolRuntime` capability abstraction, but
change the host side into two explicit runtimes: raw unbounded `host` for
host-service infrastructure and `boundedHost` for ordinary model-directed tools.
Reuse the existing workspace containment code by stripping out `projectRoot`
mapping, then route sessions, shell jobs, MCP stdio placement, and file access
tracking through the new descriptor shape.

**Tech Stack:** TypeScript, Zod, Vitest, Node `fs/promises`, `child_process`,
existing Lace runtime/session/job/MCP modules, existing projected-container
runtime.

---

## Source Specs

- `docs/specs/2026-05-18-tool-runtime-projection-spec.md`
- `docs/specs/2026-05-22-demote-git-worktrees-runtime-spec.md`

This plan supersedes the workspace-shaped parts of
`docs/superpowers/plans/2026-05-20-projected-tool-runtime.md`. Keep that older
plan as history, but do not implement new `WorkspaceToolRuntime` or
`WorktreeManager` work from it.

## Decisions Locked By This Plan

- Public runtime kinds become `host`, `boundedHost`, and `container`.
- User-facing host sessions default to `boundedHost`.
- Raw `host` must be requested explicitly and is not used as fallback when
  bounded host construction fails.
- Old persisted `local` and `workspace` bindings are migration inputs only.
- Git worktree lifecycle is outside runtime/session/MCP/tool execution.
- `WorktreeManager` is deleted from this branch.

## Decision To Confirm Before Execution

The spec leaves one wire-compatibility question open. This plan assumes:

- New protocol schemas accept `host`, `boundedHost`, and `container`.
- Agent-side persisted-state parsing can still read old `local` and `workspace`
  bindings and immediately normalize them to the new descriptor shape.
- Do not accept legacy `local` or `workspace` over the public protocol as a
  client compatibility feature unless Jesse explicitly approves that backward
  compatibility.

## File Structure

- Modify `packages/agent/src/tools/runtime/types.ts`: runtime kind and
  descriptor union become `host`/`boundedHost`/`container`.
- Modify `packages/agent/src/tools/runtime/validation.ts`: parse new bindings,
  normalize old persisted bindings, and build default bounded host bindings.
- Modify `packages/agent/src/tools/runtime/identity.ts`: identity hashing uses
  `host` and `boundedHost` descriptors with no worktree fields.
- Modify `packages/ent-protocol/src/schemas/shared.ts`: public schema accepts
  the new descriptor shapes.
- Modify `packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts`:
  protocol fixtures use `boundedHost` and `container`.
- Modify `packages/agent/src/tools/runtime/host.ts`: `HostToolRuntime.kind`
  becomes `host`.
- Create `packages/agent/src/tools/runtime/bounded-host.ts`: bounded host path,
  filesystem, and process containment.
- Create `packages/agent/src/tools/runtime/__tests__/bounded-host.test.ts`:
  containment coverage replacing workspace tests.
- Delete `packages/agent/src/tools/runtime/workspace.ts`.
- Delete `packages/agent/src/tools/runtime/__tests__/workspace.test.ts`.
- Modify `packages/agent/src/tools/runtime/factory.ts`: build `host`,
  `boundedHost`, and `container`; reject container agent placement.
- Modify `packages/agent/src/tools/runtime/__tests__/factory.test.ts`: factory
  coverage for all new runtime kinds.
- Modify `packages/agent/src/tools/runtime/__tests__/validation.test.ts` and
  `packages/agent/src/tools/runtime/__tests__/identity.test.ts`: new defaults
  and legacy migration fixtures.
- Modify `packages/agent/src/tools/runtime/__tests__/fake-runtime.ts`: fake kind
  becomes `boundedHost` unless a test needs another kind.
- Modify `packages/agent/src/core/conversation/runner.ts`: default runtime
  binding and host-path file tracking use `boundedHost`.
- Modify `packages/agent/src/rpc/handlers/session.ts`: session
  new/load/resume/fork normalize bindings and default to bounded host.
- Modify `packages/agent/src/jobs/shell-job.ts`: legacy jobs default to bounded
  host.
- Modify runtime-binding tests under `packages/agent/src/__tests__/`,
  `packages/agent/src/jobs/__tests__/`, and
  `packages/agent/src/storage/__tests__/`.
- Modify `packages/agent/src/mcp/server-manager.env-keys.test.ts` and
  `packages/agent/src/mcp/server-manager.test.ts`: use bounded host runtime
  descriptors where tests currently use workspace descriptors.
- Delete `packages/agent/src/workspace/worktree-manager.ts`.
- Delete `packages/agent/src/workspace/worktree-manager.test.ts`.
- Delete `packages/agent/src/workspace/.gitkeep` if the directory becomes empty.
- Do not modify the old specs except for a follow-up note if implementation
  uncovers a spec mismatch.

---

## Chunk 1: Runtime Model And Bounded Host Runtime

### Task 1: Runtime Descriptor Types, Validation, And Migration

**Files:**

- Modify: `packages/agent/src/tools/runtime/types.ts`
- Modify: `packages/agent/src/tools/runtime/validation.ts`
- Modify: `packages/agent/src/tools/runtime/identity.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/validation.test.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/identity.test.ts`
- Modify: `packages/ent-protocol/src/schemas/shared.ts`
- Modify: `packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts`

- [ ] **Step 1: Write failing validation tests for the new default**

Update `packages/agent/src/tools/runtime/__tests__/validation.test.ts`:

```typescript
import {
  buildDefaultBoundedHostRuntimeBinding,
  parseRuntimeExecutionBinding,
} from '../validation';

it('defaults missing host state to boundedHost runtime', () => {
  expect(
    buildDefaultBoundedHostRuntimeBinding({
      sessionId: 'sess_123',
      cwd: '/repo',
    })
  ).toMatchObject({
    schemaVersion: 1,
    identity: { runtimeId: expect.stringContaining('sess_123') },
    agentPlacement: 'host',
    toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
  });
});
```

- [ ] **Step 2: Write failing validation tests for new descriptor parsing**

Add tests that `parseRuntimeExecutionBinding()` accepts these descriptors:

```typescript
{
  schemaVersion: 1,
  identity: { runtimeId: 'rt_host' },
  agentPlacement: 'host',
  toolRuntime: { type: 'host', cwd: '/repo' },
}
```

```typescript
{
  schemaVersion: 1,
  identity: { runtimeId: 'rt_bounded' },
  agentPlacement: 'host',
  toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo/pkg' },
}
```

- [ ] **Step 3: Write failing migration tests for old persisted bindings**

Add tests that old bindings normalize to bounded host:

```typescript
expect(
  parseRuntimeExecutionBinding({
    schemaVersion: 1,
    identity: { runtimeId: 'legacy_local' },
    agentPlacement: 'host',
    toolRuntime: { type: 'local', cwd: '/repo' },
  })
).toMatchObject({
  toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
});
```

```typescript
expect(
  parseRuntimeExecutionBinding({
    schemaVersion: 1,
    identity: { runtimeId: 'legacy_workspace' },
    agentPlacement: 'host',
    toolRuntime: {
      type: 'workspace',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/project/pkg',
    },
  })
).toMatchObject({
  toolRuntime: {
    type: 'boundedHost',
    root: '/tmp/workspace',
    cwd: '/tmp/workspace/pkg',
  },
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/validation.test.ts src/tools/runtime/__tests__/identity.test.ts
```

Expected: FAIL because `boundedHost` types and
`buildDefaultBoundedHostRuntimeBinding()` do not exist yet.

- [ ] **Step 5: Update agent runtime types**

In `packages/agent/src/tools/runtime/types.ts`, replace the descriptor union
with:

```typescript
export type ToolRuntimeKind = 'host' | 'boundedHost' | 'container';

export type ToolRuntimeDescriptor =
  | { type: 'host'; cwd: string }
  | { type: 'boundedHost'; root: string; cwd: string }
  | {
      type: 'container';
      spec: {
        name: string;
        containerId?: string;
        requestedImage: string;
        resolvedImageDigest: string;
        imagePlatform: string;
        workingDirectory: string;
        mounts: RuntimeMountDescriptor[];
        env?: Record<string, string>;
        secretEnv?: Record<string, RuntimeSecretReference>;
        ports?: RuntimePortDescriptor[];
        restartPolicy?: 'unless-stopped';
      };
      cwd: string;
      helper?: RuntimeHelperDescriptor;
    };
```

- [ ] **Step 6: Update validation parsing and default builder**

In `packages/agent/src/tools/runtime/validation.ts`:

- Add `HostRuntimeDescriptorSchema`.
- Add `BoundedHostRuntimeDescriptorSchema`.
- Keep local `LegacyLocalRuntimeDescriptorSchema` and
  `LegacyWorkspaceRuntimeDescriptorSchema` inside this file only.
- Parse persisted values through a union that accepts legacy descriptors, then
  normalize to `RuntimeExecutionBinding`.
- Replace `buildDefaultLocalRuntimeBinding()` with
  `buildDefaultBoundedHostRuntimeBinding()`.
- Do not keep a public alias named `buildDefaultLocalRuntimeBinding` after all
  callers are updated.

The workspace migration helper should map `cwd` once and then discard
`projectRoot`:

```typescript
function migrateWorkspaceCwd(input: {
  projectRoot: string;
  workspaceRoot: string;
  cwd: string;
}): string {
  const workspaceRoot = resolve(input.workspaceRoot);
  const cwd = resolve(input.cwd);
  if (pathIsInside(workspaceRoot, cwd)) return cwd;

  const projectRoot = resolve(input.projectRoot);
  if (pathIsInside(projectRoot, cwd)) {
    return resolve(workspaceRoot, relative(projectRoot, cwd));
  }

  throw new Error(
    `Cannot migrate workspace runtime cwd outside workspace root: ${input.cwd}`
  );
}
```

- [ ] **Step 7: Update runtime identity normalization**

In `packages/agent/src/tools/runtime/identity.ts`:

- Normalize `{ type: 'host', cwd }`.
- Normalize `{ type: 'boundedHost', root, cwd }`.
- Remove `projectRoot` and `workspaceRoot` from new identity inputs.
- Rename functions with `Legacy` in their name only if all call sites can be
  updated in this task. If not, leave the rename for Task 10 to avoid mixing
  behavior and naming churn.

- [ ] **Step 8: Update ent-protocol public schema**

In `packages/ent-protocol/src/schemas/shared.ts`, replace the public
`LocalRuntimeDescriptorSchema` and `WorkspaceRuntimeDescriptorSchema` with
`HostRuntimeDescriptorSchema` and `BoundedHostRuntimeDescriptorSchema`.

Do not add legacy public schema support here without Jesse's approval.

- [ ] **Step 9: Update protocol-shape tests**

In `packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts`:

- Replace `localRuntimeBinding()` with `boundedHostRuntimeBinding()`.
- Replace `workspaceRuntimeBinding()` cases with `boundedHostRuntimeBinding()`.
- Keep container fixtures unchanged except for any enum naming required by
  shared schemas.

- [ ] **Step 10: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/validation.test.ts src/tools/runtime/__tests__/identity.test.ts
npm run test --workspace=packages/ent-protocol -- src/schemas/__tests__/protocol-shapes.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git status --short
git add packages/agent/src/tools/runtime/types.ts \
  packages/agent/src/tools/runtime/validation.ts \
  packages/agent/src/tools/runtime/identity.ts \
  packages/agent/src/tools/runtime/__tests__/validation.test.ts \
  packages/agent/src/tools/runtime/__tests__/identity.test.ts \
  packages/ent-protocol/src/schemas/shared.ts \
  packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts
git commit -m "feat: revise runtime descriptors for bounded host"
```

### Task 2: Bounded Host Tool Runtime

**Files:**

- Create: `packages/agent/src/tools/runtime/bounded-host.ts`
- Delete: `packages/agent/src/tools/runtime/workspace.ts`
- Create: `packages/agent/src/tools/runtime/__tests__/bounded-host.test.ts`
- Delete: `packages/agent/src/tools/runtime/__tests__/workspace.test.ts`
- Modify: `packages/agent/src/tools/runtime/host.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/host.test.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/fake-runtime.ts`

- [ ] **Step 1: Move the workspace runtime files**

Run:

```bash
git mv packages/agent/src/tools/runtime/workspace.ts packages/agent/src/tools/runtime/bounded-host.ts
git mv packages/agent/src/tools/runtime/__tests__/workspace.test.ts packages/agent/src/tools/runtime/__tests__/bounded-host.test.ts
```

This preserves the containment code history while changing the domain model.

- [ ] **Step 2: Rewrite tests around bounded host semantics**

In `bounded-host.test.ts`, replace project/workspace mapping tests with these
behaviors:

- relative paths resolve against `cwd`;
- absolute paths inside `root` are accepted;
- absolute paths outside `root` are rejected;
- `..` escapes are rejected;
- symlink reads/stats/readdir/writes that escape `root` are rejected;
- process `cwd` overrides outside `root` are rejected;
- relative process `cwd` overrides resolve from runtime `cwd`;
- canonical keys include runtime id and resolved root-local host path;
- there is no project-coordinate mapping test.

Example test:

```typescript
it('rejects absolute paths outside the bounded host root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lace-bounded-host-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));
  const runtime = new BoundedHostToolRuntime({
    id: 'rt_bounded',
    root,
    cwd: root,
  });

  await expect(
    runtime.paths.resolve(join(outside, 'secret.txt'))
  ).rejects.toThrow(/outside bounded host root/i);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/bounded-host.test.ts src/tools/runtime/__tests__/host.test.ts
```

Expected: FAIL because the moved implementation still exports
`WorkspaceToolRuntime` and still maps `projectRoot`.

- [ ] **Step 4: Implement `BoundedHostToolRuntime`**

In `bounded-host.ts`:

- Rename `WorkspaceToolRuntime` to `BoundedHostToolRuntime`.
- Rename containment classes and messages from workspace to bounded host root.
- Constructor input is
  `{ id: string; root: string; cwd: string; env?: NodeJS.ProcessEnv }`.
- Resolve `root` and `cwd` lexically.
- Require `cwd` to be inside `root`.
- Remove all `projectRoot` fields and path mapping.
- Build a `HostToolRuntime` delegate with the bounded `cwd`.
- Keep realpath checks for file APIs.
- Validate process `cwd` overrides before delegating.

The path service should be shaped like:

```typescript
class BoundedHostPathService implements RuntimePathService {
  constructor(
    private readonly root: string,
    private readonly cwd: string,
    private readonly runtimeId: string
  ) {}

  async resolve(inputPath: string): Promise<RuntimePath> {
    const runtimePath = isAbsolute(inputPath)
      ? resolve(inputPath)
      : resolve(this.cwd, inputPath);
    requireInside(
      this.root,
      runtimePath,
      `Access denied: path resolves outside bounded host root: ${inputPath}`
    );
    return {
      original: inputPath,
      runtimePath,
      hostPath: runtimePath,
      displayPath: inputPath,
    };
  }

  canonicalKey(path: RuntimePath): string {
    return `boundedHost:${this.runtimeId}:${resolve(path.runtimePath)}`;
  }
}
```

- [ ] **Step 5: Update raw host runtime kind**

In `packages/agent/src/tools/runtime/host.ts`, change:

```typescript
readonly kind = 'local' as const;
```

to:

```typescript
readonly kind = 'host' as const;
```

Update any host tests that assert the kind.

- [ ] **Step 6: Update fake runtime default kind**

In `fake-runtime.ts`, default to:

```typescript
kind: 'boundedHost',
```

Only override to `container` or `host` in tests that care about kind-specific
behavior.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/bounded-host.test.ts src/tools/runtime/__tests__/host.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git status --short
git add packages/agent/src/tools/runtime/bounded-host.ts \
  packages/agent/src/tools/runtime/__tests__/bounded-host.test.ts \
  packages/agent/src/tools/runtime/host.ts \
  packages/agent/src/tools/runtime/__tests__/host.test.ts \
  packages/agent/src/tools/runtime/__tests__/fake-runtime.ts
git add -u packages/agent/src/tools/runtime/workspace.ts \
  packages/agent/src/tools/runtime/__tests__/workspace.test.ts
git commit -m "feat: add bounded host tool runtime"
```

### Task 3: Runtime Factory For Host, Bounded Host, And Container

**Files:**

- Modify: `packages/agent/src/tools/runtime/factory.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/factory.test.ts`
- Modify: `packages/agent/src/tools/runtime/projected-container.ts`

- [ ] **Step 1: Write failing factory tests**

Add factory tests:

```typescript
it('creates raw host runtime only for explicit host descriptors', () => {
  const runtime = createToolRuntimeFromBinding({
    binding: {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_host' },
      agentPlacement: 'host',
      toolRuntime: { type: 'host', cwd: '/repo' },
    },
  });

  expect(runtime.kind).toBe('host');
});
```

```typescript
it('creates bounded host runtime for boundedHost descriptors', () => {
  const runtime = createToolRuntimeFromBinding({
    binding: {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_bounded' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
    },
  });

  expect(runtime.kind).toBe('boundedHost');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/factory.test.ts
```

Expected: FAIL because the factory still imports `WorkspaceToolRuntime`.

- [ ] **Step 3: Update the factory implementation**

In `factory.ts`:

- Import `BoundedHostToolRuntime` from `./bounded-host`.
- Keep `HostToolRuntime` for explicit `host`.
- Remove `WorkspaceToolRuntime`.
- Branch on `runtime.type === 'host'`, `runtime.type === 'boundedHost'`, and
  `runtime.type === 'container'`.
- Keep the existing `agentPlacement !== 'host'` rejection.

- [ ] **Step 4: Keep projected container descriptor extraction typed**

If `ProjectedContainerToolRuntimeDescriptor` depends on
`Extract<ToolRuntimeDescriptor, { type: 'container' }>`, verify
`packages/agent/src/tools/runtime/projected-container.ts` still typechecks after
the descriptor union changes.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/factory.test.ts src/tools/runtime/__tests__/projected-container.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/agent/src/tools/runtime/factory.ts \
  packages/agent/src/tools/runtime/__tests__/factory.test.ts \
  packages/agent/src/tools/runtime/projected-container.ts
git commit -m "feat: create bounded host runtime from bindings"
```

---

## Chunk 2: Session, Job, And File Tracking Defaults

### Task 4: Default Host Sessions Use Bounded Host

**Files:**

- Modify: `packages/agent/src/core/conversation/runner.ts`
- Modify: `packages/agent/src/rpc/handlers/session.ts`
- Modify: `packages/agent/src/__tests__/session-fork.durable-history.test.ts`
- Modify: `packages/agent/src/__tests__/session-load.rehydrate-config.test.ts`
- Modify: `packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts`

- [ ] **Step 1: Write failing default-session tests**

Update tests that currently expect `toolRuntime.type: 'local'` so new sessions
and forks expect:

```typescript
toolRuntime: {
  type: 'boundedHost',
  root: createdCwd,
  cwd: createdCwd,
}
```

Add at least one explicit assertion that a missing runtime binding does not
produce raw `host`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/__tests__/session-fork.durable-history.test.ts src/__tests__/session-load.rehydrate-config.test.ts
```

Expected: FAIL because session code still imports
`buildDefaultLocalRuntimeBinding()`.

- [ ] **Step 3: Replace default builder imports**

In `runner.ts` and `session.ts`:

- Import `buildDefaultBoundedHostRuntimeBinding`.
- Replace default local calls.
- Preserve explicit supplied runtime bindings after parsing/normalization.

Example:

```typescript
const runtimeBinding =
  this.config.runtimeBinding ??
  buildDefaultBoundedHostRuntimeBinding({
    sessionId: this.config.sessionId,
    cwd,
  });
```

- [ ] **Step 4: Normalize loaded stored bindings before activation**

In `session.ts`, when loading stored state:

- Parse `loaded.state.config.runtimeBinding`.
- Use the parsed value when writing the active session state.
- Ensure invalid stored bindings fail before `state.activeSession` is replaced.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/__tests__/session-fork.durable-history.test.ts src/__tests__/session-load.rehydrate-config.test.ts src/__tests__/agent-process.delegate.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/agent/src/core/conversation/runner.ts \
  packages/agent/src/rpc/handlers/session.ts \
  packages/agent/src/__tests__/session-fork.durable-history.test.ts \
  packages/agent/src/__tests__/session-load.rehydrate-config.test.ts \
  packages/agent/src/__tests__/agent-process.delegate.e2e.test.ts
git commit -m "feat: default sessions to bounded host runtime"
```

### Task 5: Shell Jobs And Job Persistence Use Bounded Host Defaults

**Files:**

- Modify: `packages/agent/src/jobs/shell-job.ts`
- Modify: `packages/agent/src/jobs/__tests__/shell-job.test.ts`
- Modify: `packages/agent/src/jobs/__tests__/job-manager.test.ts`
- Modify:
  `packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts`
- Modify: `packages/agent/src/__tests__/server-job-runtime-binding.test.ts`

- [ ] **Step 1: Write failing job tests**

Update legacy job tests so jobs without stored `runtimeBinding` default to:

```typescript
toolRuntime: { type: 'boundedHost', root: activeWorkDir, cwd: activeWorkDir }
```

Keep explicit job runtime-binding tests, but update fixtures from `local` to
`boundedHost`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/shell-job.test.ts src/jobs/__tests__/job-manager.test.ts src/__tests__/agent-process.async-workflow.e2e.test.ts src/__tests__/server-job-runtime-binding.test.ts
```

Expected: FAIL because shell jobs still build local default bindings.

- [ ] **Step 3: Update shell-job default builder**

In `shell-job.ts`, replace `buildDefaultLocalRuntimeBinding()` with
`buildDefaultBoundedHostRuntimeBinding()`.

Do not change job output paths; job logs remain host-owned artifacts.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/jobs/__tests__/shell-job.test.ts src/jobs/__tests__/job-manager.test.ts src/__tests__/agent-process.async-workflow.e2e.test.ts src/__tests__/server-job-runtime-binding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/agent/src/jobs/shell-job.ts \
  packages/agent/src/jobs/__tests__/shell-job.test.ts \
  packages/agent/src/jobs/__tests__/job-manager.test.ts \
  packages/agent/src/__tests__/agent-process.async-workflow.e2e.test.ts \
  packages/agent/src/__tests__/server-job-runtime-binding.test.ts
git commit -m "feat: default shell jobs to bounded host runtime"
```

### Task 6: File Access Tracking Uses Runtime Host Paths Without `local`

**Files:**

- Modify: `packages/agent/src/core/conversation/runner.ts`
- Modify: `packages/agent/src/tools/runtime/file-access-tracker.ts`
- Modify:
  `packages/agent/src/tools/runtime/__tests__/file-access-tracker.test.ts`
- Modify: `packages/agent/src/core/conversation/__tests__/runner.test.ts`

- [ ] **Step 1: Write failing runner/file-tracking tests**

Update or add a runner test proving a bounded host read records the real host
path when `RuntimePath.hostPath` is present.

The test should fail if code checks `runtime.kind === 'local'`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test --workspace=packages/agent -- src/core/conversation/__tests__/runner.test.ts src/tools/runtime/__tests__/file-access-tracker.test.ts
```

Expected: FAIL if runner still treats only `local` as host-readable.

- [ ] **Step 3: Update runner host-path tracking**

In `runner.ts`, change this shape:

```typescript
const hostPath =
  path.hostPath ?? (runtime.kind === 'local' ? path.runtimePath : undefined);
```

to:

```typescript
const hostPath =
  path.hostPath ?? (runtime.kind === 'host' ? path.runtimePath : undefined);
```

Because `boundedHost` path resolution should set `hostPath`, the fallback only
belongs to raw host.

- [ ] **Step 4: Update old runner fixtures**

In `runner.test.ts`, replace `local` and `workspace` runtime fixtures with
`boundedHost` unless a test is specifically checking explicit raw host.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/core/conversation/__tests__/runner.test.ts src/tools/runtime/__tests__/file-access-tracker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/agent/src/core/conversation/runner.ts \
  packages/agent/src/tools/runtime/file-access-tracker.ts \
  packages/agent/src/tools/runtime/__tests__/file-access-tracker.test.ts \
  packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "fix: track bounded host file reads by runtime path"
```

---

## Chunk 3: MCP And Protocol Surfaces

### Task 7: MCP Runtime Placement Uses Bounded Host Fixtures

**Files:**

- Modify: `packages/agent/src/mcp/server-manager.ts`
- Modify: `packages/agent/src/mcp/server-manager.test.ts`
- Modify: `packages/agent/src/mcp/server-manager.env-keys.test.ts`
- Modify: `packages/agent/src/tools/runtime/runtime-stdio-transport.ts`
- Modify:
  `packages/agent/src/tools/runtime/__tests__/runtime-stdio-transport.test.ts`
- Modify: `packages/agent/src/rpc/handlers/mcp-servers.ts`

- [ ] **Step 1: Write failing MCP fixture updates**

Replace workspace-shaped runtime bindings in MCP tests with bounded host
bindings:

```typescript
runtimeBinding: {
  schemaVersion: 1,
  identity: { runtimeId: 'rt_bounded' },
  agentPlacement: 'host',
  toolRuntime: { type: 'boundedHost', root: tmpRoot, cwd: tmpRoot },
}
```

Add one assertion that `placement: 'toolRuntime'` starts stdio MCP with
`runtime.cwd` from bounded host.

- [ ] **Step 2: Run tests to verify they fail if old types remain**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts src/tools/runtime/__tests__/runtime-stdio-transport.test.ts
```

Expected: FAIL until all runtime kinds and fixtures are updated.

- [ ] **Step 3: Update runtime stdio transport kind checks**

In `runtime-stdio-transport.ts`, keep container-specific environment handling:

```typescript
return runtime.kind === 'container' ? {} : getDefaultEnvironment();
```

Do not add special handling for `boundedHost`; it behaves like host for env
inheritance while bounded process cwd validation remains in the runtime.

- [ ] **Step 4: Update MCP manager tests and runtime creation**

Use `new BoundedHostToolRuntime({ id, root: cwd, cwd })` for tool-runtime
placement tests that need host filesystem behavior.

Use `new HostToolRuntime({ id, cwd })` only for explicit host-service tests.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/mcp/server-manager.test.ts src/mcp/server-manager.env-keys.test.ts src/tools/runtime/__tests__/runtime-stdio-transport.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/agent/src/mcp/server-manager.ts \
  packages/agent/src/mcp/server-manager.test.ts \
  packages/agent/src/mcp/server-manager.env-keys.test.ts \
  packages/agent/src/tools/runtime/runtime-stdio-transport.ts \
  packages/agent/src/tools/runtime/__tests__/runtime-stdio-transport.test.ts \
  packages/agent/src/rpc/handlers/mcp-servers.ts
git commit -m "test: use bounded host runtime for MCP placement"
```

### Task 8: Storage And Protocol Fixtures Stop Mentioning Local/Workspace

**Files:**

- Modify: `packages/agent/src/storage/__tests__/session-store.test.ts`
- Modify: `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`
- Modify: `packages/agent/src/tools/ripgrep-search.test.ts`
- Modify: `packages/agent/src/tools/file-edit-actual.test.ts`
- Modify: any remaining test files found by `rg`.

- [ ] **Step 1: Find remaining old runtime fixture text**

Run:

```bash
rg -n "type: 'local'|type: 'workspace'|WorkspaceToolRuntime|workspaceRoot|projectRoot|kind: 'local'|kind = 'local'" packages/agent/src packages/ent-protocol/src
```

Expected: matches remain in tests and maybe migration tests only.

- [ ] **Step 2: Update non-migration fixtures**

For ordinary host-run tests, use:

```typescript
toolRuntime: { type: 'boundedHost', root: cwd, cwd }
```

For explicit host-service tests, use:

```typescript
toolRuntime: {
  type: ('host', cwd);
}
```

Leave `local` and `workspace` strings only in migration tests that intentionally
parse legacy persisted state.

- [ ] **Step 3: Run broad targeted tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/storage/__tests__/session-store.test.ts src/tools/implementations/__tests__/delegate.test.ts src/tools/ripgrep-search.test.ts src/tools/file-edit-actual.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git status --short
git add packages/agent/src/storage/__tests__/session-store.test.ts \
  packages/agent/src/tools/implementations/__tests__/delegate.test.ts \
  packages/agent/src/tools/ripgrep-search.test.ts \
  packages/agent/src/tools/file-edit-actual.test.ts
git commit -m "test: update runtime fixtures for bounded host"
```

If Step 1 found additional non-migration files, add those exact file paths to
the **Files** list above before editing, then stage those same exact paths
before the commit. Do not use `git add -A`.

---

## Chunk 4: Delete Worktree And Workspace Runtime Leftovers

### Task 9: Remove WorktreeManager

**Files:**

- Delete: `packages/agent/src/workspace/worktree-manager.ts`
- Delete: `packages/agent/src/workspace/worktree-manager.test.ts`
- Delete: `packages/agent/src/workspace/.gitkeep` if the directory is empty

- [ ] **Step 1: Verify there are no production imports**

Run:

```bash
rg -n "WorktreeManager|worktree-manager" packages docs --glob '!docs/specs/**'
```

Expected: only `packages/agent/src/workspace/worktree-manager.ts` and
`packages/agent/src/workspace/worktree-manager.test.ts`.

- [ ] **Step 2: Delete WorktreeManager files**

Run:

```bash
git rm packages/agent/src/workspace/worktree-manager.ts packages/agent/src/workspace/worktree-manager.test.ts
```

If `packages/agent/src/workspace` contains only `.gitkeep`, remove it too:

```bash
git rm packages/agent/src/workspace/.gitkeep
```

- [ ] **Step 3: Verify WorktreeManager is gone**

Run:

```bash
rg -n "WorktreeManager|worktree-manager" packages docs --glob '!docs/specs/**'
```

Expected: no matches.

- [ ] **Step 4: Run agent tests that previously included workspace directory**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime/__tests__/bounded-host.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -u packages/agent/src/workspace
git commit -m "chore: remove worktree manager"
```

### Task 10: Remove Workspace Runtime Names And Legacy Builder Names

**Files:**

- Modify: `packages/agent/src/tools/runtime/validation.ts`
- Modify: `packages/agent/src/tools/runtime/identity.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/validation.test.ts`
- Modify: `packages/agent/src/tools/runtime/__tests__/identity.test.ts`
- Modify: any source file found by the cleanup search.

- [ ] **Step 1: Search for old runtime concepts**

Run:

```bash
rg -n "WorkspaceToolRuntime|workspaceRoot|projectRoot|buildDefaultLocalRuntimeBinding|ToolRuntimeKind = 'local'|type: 'local'|type: 'workspace'|kind: 'local'" packages/agent/src packages/ent-protocol/src
```

Expected: matches only in migration tests and legacy migration helper names.

- [ ] **Step 2: Remove old public names**

Remove `buildDefaultLocalRuntimeBinding` completely. Any call site should use
`buildDefaultBoundedHostRuntimeBinding`.

If `buildLegacyRuntimeId` is still exported, either:

- rename it to `buildRuntimeId` and update call sites in the same commit; or
- leave it only if it is specifically used to identify migrated legacy records.

Do not leave names that imply new runtime behavior is still local/workspace.

- [ ] **Step 3: Keep migration helper scope narrow**

If legacy descriptor schemas remain, keep them private to `validation.ts`.
Migration tests may mention `local`, `workspace`, `projectRoot`, and
`workspaceRoot`; production runtime/session/MCP/tool code must not.

- [ ] **Step 4: Run cleanup search again**

Run:

```bash
rg -n "WorkspaceToolRuntime|workspaceRoot|projectRoot|buildDefaultLocalRuntimeBinding|ToolRuntimeKind = 'local'|kind: 'local'" packages/agent/src packages/ent-protocol/src
```

Expected: no production matches. Migration-test/helper matches are acceptable
only if they are obviously scoped to parsing old persisted bindings.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck --workspace=packages/ent-protocol
npm run typecheck --workspace=packages/agent
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/agent/src/tools/runtime/validation.ts \
  packages/agent/src/tools/runtime/identity.ts \
  packages/agent/src/tools/runtime/__tests__/validation.test.ts \
  packages/agent/src/tools/runtime/__tests__/identity.test.ts
git commit -m "chore: remove workspace runtime naming"
```

If Step 1 found additional cleanup files, add those exact file paths to the
**Files** list above before editing, then stage those same exact paths before
the commit. Do not use `git add -A`.

---

## Chunk 5: Final Verification And Documentation

### Task 11: Final Verification Sweep

**Files:**

- Modify only files needed to fix failures found by verification.

- [ ] **Step 1: Run all runtime tests**

Run:

```bash
npm run test --workspace=packages/agent -- src/tools/runtime
```

Expected: PASS.

- [ ] **Step 2: Run agent tests**

Run:

```bash
npm run test --workspace=packages/agent
```

Expected: PASS.

- [ ] **Step 3: Run protocol tests**

Run:

```bash
npm run test --workspace=packages/ent-protocol
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck --workspace=packages/ent-protocol
npm run typecheck --workspace=packages/agent
```

Expected: PASS.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint --workspace=packages/ent-protocol
npm run lint --workspace=packages/agent
```

Expected: PASS.

- [ ] **Step 6: Run final concept searches**

Run:

```bash
rg -n "WorktreeManager|WorkspaceToolRuntime|buildDefaultLocalRuntimeBinding" packages docs --glob '!docs/specs/**' --glob '!docs/superpowers/plans/**'
rg -n "type: 'local'|type: 'workspace'|kind: 'local'|workspaceRoot|projectRoot" packages/agent/src packages/ent-protocol/src
```

Expected: no production matches. Legacy migration tests/helpers may mention old
descriptor fields if they are clearly testing migration from persisted state.

- [ ] **Step 7: Run format check and diff check**

Run:

```bash
npm run format:check
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Fix any failures with root-cause patches**

For each failure:

- identify the failing behavior;
- patch the smallest relevant source/test files;
- rerun the failed command;
- do not bypass hooks or skip failing checks.

- [ ] **Step 9: Commit final fixes if needed**

Stage only the exact modified file paths shown by `git status --short` that are
part of the root-cause fix. If no fixes were needed, do not create an empty
commit.

```bash
git status --short
```

Then run `git add` with only the exact root-cause fix file paths.

```bash
git commit -m "fix: complete bounded host runtime migration"
```

### Task 12: Implementation Completion Notes

**Files:**

- Modify: `docs/specs/2026-05-22-demote-git-worktrees-runtime-spec.md` only if
  implementation uncovered a real spec correction.
- Modify:
  `docs/superpowers/plans/2026-05-22-demote-worktrees-bounded-host-runtime.md`
  only to check off completed tasks during execution.

- [ ] **Step 1: Compare final behavior to acceptance criteria**

Verify each spec acceptance criterion:

- runtime descriptors contain no git/worktree fields;
- session runtime binding persistence does not record `projectRoot`;
- default host-orchestrated sessions use `boundedHost`;
- runtime path resolution has one coordinate system per runtime;
- projected container behavior still works;
- runtime-placed MCP uses active runtime cwd;
- host-orchestrated sessions reject `agentPlacement: 'container'`;
- `WorktreeManager` is removed;
- tests cover legacy workspace migration into bounded host;
- tests cover rejecting paths outside bounded root.

- [ ] **Step 2: Record spec mismatches only if real**

If implementation required changing a spec decision, update the spec in a
separate commit. Do not add implementation notes to the spec just because the
work is done.

- [ ] **Step 3: Commit plan checkbox updates if execution tracked them**

```bash
git status --short
git add docs/superpowers/plans/2026-05-22-demote-worktrees-bounded-host-runtime.md
git commit -m "docs: mark bounded host runtime plan progress"
```

Only do this if the execution session actually checked boxes in the plan.

---

## Handoff

Plan complete. Implement with `superpowers:subagent-driven-development` if the
harness permits subagents; otherwise use `superpowers:executing-plans` and
complete one task at a time. Do not start coding until the wire-compatibility
decision above is accepted or revised.
