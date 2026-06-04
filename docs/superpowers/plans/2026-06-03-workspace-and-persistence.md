# Workspace + persistence (D4 / #5) Implementation Plan — rev 4

> **For agentic workers:** REQUIRED SUB-SKILL:
> superpowers:test-driven-development + superpowers:executing-plans (or
> subagent-driven-development). Steps use checkbox (`- [ ]`). Mostly **lace**
> (TypeScript, `packages/agent`), branch `pri2012-shim-lace`. Not
> box-coordinated like #3/#4. **#3 is already merged** — chase by symbol where
> the spec cites lines.

> **rev 4 (2026-06-03):** confirmatory 3-opus panel on rev 3 found one
> architectural BLOCKER (two lenses, independently) + correctness/feasibility
> fixes. **The live-writer invariant was FALSE: per_invocation containers
> OUTLIVE the lace process that spawned them.** A per*invocation container is
> `docker create … sleep infinity` + detached `docker start` (no `--rm`,
> daemon-managed); `killAllRunningJobs`/SIGTERM kills the subagent \_process*,
> but the _container_ keeps `/work` bind-mounted RW until the parent's
> **in-memory** `PerInvocationReaper` idle timer fires (default 30 min) — and on
> parent **SIGKILL** that timer dies with the process, so the container runs
> until the next boot's `startup-reaper`. So owner-**process**-pid liveness is
> the wrong gate: **the writer is the CONTAINER, not the process.** Fix: **(1)**
> every remove path `await containerManager.destroy(specName)` (+ cancel the
> idle-reap) _before_ `rm`, driven from the data that carries
> `containerSpecName`; **(2)** the cross-process crash sweep gates on
> **container liveness** (owner-pid says "this subtree is an orphan worth
> reclaiming"; a docker check says "it's _safe_ — no running container holds its
> `/work`"), and the boot sweep runs **after** `startup-reaper` (which kills
> orphan `lace-*` containers) so the boot pass is clean for free. Sweep cadence
> = **interval + boot, docker-gated** (Jesse). Other panel fixes: the remover's
> `rmdirSync` was unconditional after continue-on-error → throws `ENOTEMPTY`
> uncaught at the top level (crashes the sweep interval / aborts teardown) — now
> tolerant; resume-after-**crash** resurrected an empty `/work` (the
> non-resumable flag was in-memory, doesn't survive SIGKILL) → gate resume on
> the workspace existing+non-empty; `/proc/<pid>/stat` field-22 parse must split
> **after the last `)`** (`comm` may contain spaces/parens); `$TMPDIR`
> host-subagent injection needs a **separate site** (`job.executionEnv` is
> assembled container-only in `job-manager.ts`; host subagents have no
> `containerExecutionContext`); write `.owner` **before** the first child mkdir
> (create-gap); `AgentServerState` is `server-types.ts` at src root (not
> `core/server-types.ts`).

> **Kept from rev 3 (verified still-sound by the panel):** no "root process"
> role + per-process reaper map (both rev-2 blockers stay fixed); owner-pid
> liveness direction is right (now _plus_ the container gate); disjointness
> check at `initialize`-time; 5-site ToolContext wiring; three-valued
> `toolRuntime.type`; release-auth server-injected/unspoofable; a child cannot
> forge a sibling's `.owner` (mount-scoping); persistent-box never reaped; the
> remover's walk is escape-safe.

> **Correction to the kit (kept from rev 1):** persistent-box STAYS a genuinely
> persistent container — `containerSharing` is NOT dissolved. A long-running
> batch job in a persistent box must never be reaped. #5 only (a) makes
> "persistent-box never reaped" an asserted invariant and (b) fixes the
> per_invocation work-product lifecycle.

**Goal:** A per_invocation subagent's **workspace is its result** — it survives
the disposable container, is exposed to the parent via a shared results tree,
and is reclaimed by **explicit release / parent clean-close / per-process
teardown** (live path) or a **container-liveness-gated, owner-pid sweep** (crash
backstop) — never an idle/exit timer, never mtime. Plus: every subagent gets an
ephemeral workdir + auto-cleaned `$TMPDIR`; the current scratch-dir leak is
fixed; persistent-box is provably never reaped.

---

## Process topology (read first — it drives the whole design)

- **Every lace agent is the SAME re-exec'd entrypoint.** A subagent is spawned
  via `spawn(process.execPath, [process.argv[1]], …)` (`subagent-spawn.ts`) and
  runs the identical `boot()` (`main.ts`). **A process cannot know at boot
  whether it is "root" or a subagent, nor who its parent is** — that arrives
  later via the `session/new` `parent` param. Therefore the design has **no
  "root process" role**.
- **Containers outlive their spawning process.** A per_invocation container is
  daemon-managed (`docker create … sleep infinity` + detached start, no `--rm`);
  it is destroyed only by the parent's in-memory `PerInvocationReaper` idle
  timer (default 30 min, `LACE_PER_INVOCATION_IDLE_TTL_MS`), by
  `release_delegation`, or by `startup-reaper` at a later boot. On parent
  SIGKILL the idle timer dies and the container is orphaned until the next boot.
  **Workspace reclamation safety is therefore keyed on CONTAINER liveness, not
  lace-process liveness.**
- **The in-memory `WorkspaceReaper` map is per-process** and tracks only the
  children _this_ process created (the `delegate` tool runs in-process and
  mkdirs the child's workspace in the calling process). A nested grandchild's
  workspace lives only in the _intermediate_ parent's process map — no other
  process can reach it in memory. Cross-process reclamation is therefore
  **filesystem-mediated** (the sweep, Part 4), never via another process's map.
- A single process **may host multiple sessions** over its life
  (session-switch). It owns every workspace it created across all those
  sessions; on its own teardown it disposes all of them (`releaseAllTracked()`).

## Security model (read second)

- **Container subagents are isolated by MOUNT-SCOPING, not file modes.** Each
  per_invocation child's container mounts **only its own**
  `<base>/<parentId>/<childId>` subdir at `/work`. Since all containers run as
  the same agent uid, `0700` is hygiene, NOT the boundary — the boundary is that
  a child's container spec never contains another child's path or the parent
  base. (Test that, not a cross-read.) A child therefore **cannot read, forge,
  or plant a sibling's `.owner`** — the `.owner` marker lives at
  `<base>/<parentId>/.owner`, never in a child's mount.
- **Host subagents are NOT a security boundary.** A host child-process subagent
  runs as the same uid, inherits the parent's env + workDir, sees the whole host
  fs — it can read any sibling's workspace and the session store. **Therefore:
  adversarial / untrusted / prompt-injectable work MUST run as a per*invocation
  \_container* persona, never as a host subagent.** The plan gives host
  subagents an ephemeral workdir + `$TMPDIR` for hygiene, not cross-sibling
  isolation. State this in the persona docs.
- **Parent reads child output = untrusted input.** The parent (often the root
  coworker) reads child workspaces; a prompt-injected child writes arbitrary
  content there. The delegate result must frame the workspace as **untrusted
  subagent output** (like web/tool content), so the parent model doesn't treat
  child-written text as instructions.
- **Reads of a still-running child are possibly-incomplete.** A containerized
  parent's read-only base mount (Part 2 Step 3) exposes _all_ its children,
  including ones still writing (background mode). A workspace is only
  **complete** once the child's job reports done. Frame it: read a child
  workspace as untrusted **and** as possibly-incomplete until the child's job
  has completed.
- **Invariant: we never remove a workspace whose CONTAINER is still running.**
  Every remove path destroys the owning container (and cancels its idle-reap)
  _before_ `rm`: `release_delegation`, clean-close, and per-process teardown all
  call `disposeAndRelease` (Part 3); the cross-process sweep skips any subtree
  whose `/work` is a live container's bind source (Part 4). Symlink-safety in
  the remover (Part 1 Step 4) is belt-and-suspenders against symlinks a child
  planted _before_ its container died.

## Decisions (Jesse, 2026-06-03)

- persistent-box stays persistent; `containerSharing` kept.
- Release = explicit tool (consuming parent only) + parent clean-close +
  per-process teardown; retention ceiling = **per-parent count**.
- Crash/restart reclamation = a sweep gated on **owner-pid liveness AND
  container liveness** (no persistent registry, no mtime). Cadence =
  **interval + boot, docker-gated**; the boot pass runs after `startup-reaper`.

---

## Part 1 — results-tree + owner marker + WorkspaceReaper + a symlink-safe, confined remover

**Files:** Create `jobs/results-tree.ts` + `jobs/workspace-reaper.ts`; wire the
reaper onto `AgentServerState` (`server-types.ts`, **src root**).

- [ ] **Step 1: results-tree layout** (`results-tree.ts`):
  - `resultsBase()` =
    `process.env.LACE_WORK_DIR ?? path.join(os.tmpdir(), 'lace-work')` (match
    `delegate.ts`'s current `scratchBase`).
  - `childWorkspaceDir(parentId, childId)` = `<base>/<parentId>/<childId>`.
    **Both segments must be defined** — callers pass
    `context.activeSessionId ?? 'delegate'` for `parentId` (it is
    `string | undefined`; `delegate.ts` already uses this exact fallback) and
    the child **session** id for `childId`.
  - `ownerMarkerPath(parentId)` = `<base>/<parentId>/.owner`.
  - Unit-test: path layout, `..`-escape rejection (reject any id containing `/`
    or `..`), and that `childWorkspaceDir` always realpath-confines under
    `resultsBase()`.
- [ ] **Step 2: the owner marker** (`results-tree.ts`):
  - `writeOwnerMarker(parentId)` — atomically (`write` to
    `<base>/<parentId>/.owner.tmp` then `rename`) writes
    `{ pid: process.pid, startNonce: readProcStartTime(process.pid) }` as JSON.
    **Idempotent**; the current live process's pid always wins.
  - `readProcStartTime(pid)` reads `/proc/<pid>/stat` and returns field 22 (the
    kernel start-time, the anti-pid-recycle nonce). **Parse after the last
    `)`:** field 2 (`comm`) is parenthesized and may contain spaces/`)`, so
    `const rest = stat.slice(stat.lastIndexOf(')') + 2); const startTime = rest.split(' ')[19];`
    (field 22 = index 19 of the post-`comm` tail). Unit-test with a fabricated
    stat line whose `comm` contains a space and a `)`.
  - `ownerIsAlive(marker)` = `marker` parses **and**
    `process.kill(marker.pid, 0)` succeeds (ESRCH → dead) **and**
    `readProcStartTime(marker.pid) === marker.startNonce` (recycled-pid mismatch
    → dead). A missing/unparseable marker → **dead** (pre-v1 cruft or a failed
    create; safe to reclaim).
  - Unit-test: own marker is alive; a fabricated `{pid:<unused>}` is dead; a
    pid-with-wrong-nonce is dead; missing file is dead.
- [ ] **Step 3: WorkspaceReaper** (`workspace-reaper.ts`) — in-memory
      `Map<childId,{parentId, path, containerSpecName}>`, NO timers. **Tracks
      `containerSpecName` so it can destroy the container before `rm`.** Holds
      late-bound refs to `containerManager` and `perInvocationReaper` (set in
      `boot()` after the container manager resolves — mirror how
      `perInvocationReaper` is constructed `null` and replaced in `main.ts`).
      API:
  - `track({childId, parentId, path, containerSpecName})`.
  - `async dispose(childId)` — the single safe-remove primitive:
    `perInvocationReaper?.cancelReap(childId)` →
    `if (containerSpecName) await containerManager?.destroy(containerSpecName)`
    (idempotent; tolerate already-gone) →
    `safeRemoveWorkspace(path, resultsBase())` → `tracked.delete(childId)`. A
    `dispose` of an unknown id is a no-op (the sweep is the backstop for entries
    this map forgot).
  - `async releaseAllForParent(parentId)` — `dispose` each tracked entry with
    that `parentId`, **per-entry try/catch** (one failure must not strand the
    rest).
  - `async releaseAllTracked()` — `dispose` every tracked entry, **per-entry
    try/catch** (used on teardown).
  - `list()`.
  - Unit-test (with a fake containerManager): `dispose` calls `cancelReap` then
    `destroy(specName)` then removes the dir, in that order; `dispose` of
    unknown id is a no-op; a `destroy` rejection still lets the rest of
    `releaseAllTracked` proceed.
- [ ] **Step 4: the confined, symlink-safe remover** (`safeRemoveWorkspace`).
      The container is always destroyed before this runs (no live writer), but
      the remover must still be symlink-safe (statically-planted links),
      **continue-on-error**, and **never throw past the caller** (an `ENOTEMPTY`
      after a skip must not crash the sweep interval):

```typescript
// Never follow a child-planted symlink out of the results base.
// Re-lstat every entry immediately before acting (do NOT trust readdir's cached
// dirent type), and never let one bad entry abort the sweep.
function safeRemoveWorkspace(path: string, base: string): void {
  const realBase = fs.realpathSync(base);
  const top = fs.lstatSync(path); // lstat: do not follow a symlinked top
  if (top.isSymbolicLink() || !top.isDirectory()) {
    fs.unlinkSync(path); // a symlink/file top: unlink, never recurse
    return;
  }
  const real = fs.realpathSync(path);
  if (real !== realBase && !real.startsWith(realBase + '/')) {
    throw new Error(`refusing to reap path outside results base: ${real}`);
  }
  for (const name of fs.readdirSync(real)) {
    // names only — re-lstat each, no cached type
    const p = `${real}/${name}`;
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isDirectory())
        fs.unlinkSync(p); // unlink follows nothing
      else safeRemoveWorkspace(p, realBase); // recurse only REAL dirs
    } catch (e) {
      logger.warn(`workspace-reaper: skipping ${p}: ${e}`); // continue-on-error
    }
  }
  try {
    fs.rmdirSync(real);
  } catch (e) {
    // tolerant: a non-empty dir after a skip
    logger.warn(`workspace-reaper: leaving non-empty ${real}: ${e}`);
  } // → next pass
}
```

Unit tests: retain-until-dispose; a child-planted symlink
`<child>/x -> /home/jesse` is unlinked, its target untouched; a symlinked top
dir is unlinked (not recursed); a realpath that escapes the base throws (and the
**caller** must catch it — see Parts 3/4); a single un-removable entry is
skipped and the rest are removed; a **top dir left non-empty after a skip does
NOT throw**.

- [ ] **Step 5: place on `AgentServerState`** — construct the WorkspaceReaper
      eagerly in `createAgentServerState` (`server-types.ts`, src root) with
      null runtime refs; call
      `workspaceReaper.bindRuntime(containerManager, perInvocationReaper)` in
      `boot()` right after the container manager + `perInvocationReaper` resolve
      (`main.ts`, beside the existing `perInvocationReaper` replacement).
      Commit.
- [ ] **Step 6: assert persistent-box is never reaped** — a `persistent` job
      never schedules a container reap (`maybeScheduleReapAfter` early-returns
      on `containerSharing !== 'per_invocation'`, `subagent-job.ts`); the
      WorkspaceReaper never tracks a persistent box; the sweep (Part 4) is
      confined to `resultsBase()` (disjoint from the box's durable mount per
      Part 2 Step 0) AND skips live-container subtrees. Test all three. Commit.

## Part 2 — Shared results tree (container mount-scoping is the boundary)

**Files:** `tools/implementations/delegate.ts` (scratch-path + owner-marker +
resume guard), `jobs/persona-container-spec.ts` (the `/work` mount source, ~line
198 post-#3), `rpc/handlers/initialize.ts` (disjointness check).

- [ ] **Step 0: disjointness check at `initialize`-time (NOT boot).**
      `state.containerMounts` is empty at boot — it's populated by the
      `initialize` RPC (`initialize.ts`,
      `state.containerMounts = parseContainerMounts(...)`). Right after it's
      set, assert `realpath(resultsBase())` is **disjoint** from every
      `MountRegistryEntry.hostPath` realpath (neither equals nor nests either
      way), so the sweep can never descend into a durable persona mount.
      `mkdirSync(resultsBase(), {recursive:true})` first (realpath needs it to
      exist; compare normalized-absolute if realpath throws ENOENT). **Fail
      `initialize`** (not boot) on overlap. Unit-test the overlap predicate +
      the empty-at-boot fact.
- [ ] **Step 1:** In `delegate.ts`, **write the owner marker BEFORE creating the
      child dir** (close the create-gap so a concurrent sweep never sees a child
      dir under a markerless parent):
      `writeOwnerMarker(context.activeSessionId ?? 'delegate')`, then replace
      the per_invocation scratch-path computation (today
      `scratchDirHostPath = path.join(scratchBase, childSessionId!)`) with
      `childWorkspaceDir(context.activeSessionId ?? 'delegate', childSessionId!)` +
      `mkdirSync(..., {recursive:true, mode:0o700})`. The child container still
      mounts **only this dir** at `/work` (only the source path changes; the
      mount injection in `persona-container-spec.ts` is otherwise unchanged).
- [ ] **Step 2:** Track it in the WorkspaceReaper at delegate time:
      `track({childId: childSessionId, parentId: context.activeSessionId ?? 'delegate', path: scratchDirHostPath, containerSpecName})`
      — capture the resolved per_invocation container spec name here (the same
      name `maybeScheduleReapAfter`/`PerInvocationReaper` use; chase by symbol,
      it's on the job/spec).
- [ ] **Step 3: parent read access.** Discriminant =
      `context.runtimeBinding?.toolRuntime.type`, which is **three-valued:
      `'host' | 'boundedHost' | 'container'`** (`tools/runtime/types.ts`). A
      **`container`** parent gets `<base>/<parentId>` mounted **read-only,
      once** at session start (a bind of the base dir — child subdirs created
      later appear live; it is NOT a snapshot). A **non-container** parent
      (`host` or `boundedHost` — the root coworker is `host`) reads
      `<base>/<parentId>` directly, no mount. Do not write `=== 'host'` (that
      strands `boundedHost`). Frame the read per the security model: untrusted
      **and** possibly-incomplete until the child job completes.
- [ ] **Step 4:** Isolation test = assert child A's resolved
      `ContainerSpec.mounts` contains ONLY A's `<childId>` path (never the base
      or a sibling) — NOT a cross-read test (that false-passes on single-uid
      CI). The spec→docker mount chain is 1:1 with no filtering
      (`projected-container.ts` → `docker-container.ts -v`), so the spec
      assertion is a valid proxy. Commit.

## Part 3 — Release: tool + clean-close + teardown (all destroy the container first); count ceiling

- [ ] **Step 1: wire a `workspaceReaper` handle through to `ToolContext` — 5
      sites** (mirror `perInvocationReaper` exactly):
  1. `tools/types.ts` — add `workspaceReaper` to the **`ToolContext` interface**
     (~line 67, beside `perInvocationReaper`; this is the field the tool reads).
  2. `server-types.ts` (**src root**, NOT `core/`) — `AgentServerState` (~line
     210; beside the handle from Part 1 Step 5).
  3. `rpc/handlers/prompt.ts` — `RunnerDependencies` assembly (~line 351).
  4. `core/conversation/types.ts` — deps (~line 190).
  5. `core/conversation/runner.ts` — `ToolContext` assembly (~line 1664).
- [ ] **Step 2: `release_delegation` tool** — schema `{ subagentSessionId }`.
      **Register via the per-session path** (mirror `delegate` in
      `executor.ts registerAllAvailableTools` ~line 296), add its name to
      `PER_SESSION_BUILTIN_NAMES` (`builtins.ts`, today
      `{'delegate','use_skill'}`) and `LACE_BUILTIN_TOOL_NAMES` (`executor.ts`).
      Ownership: read `parentId` from `context.activeSessionId` (server-injected
      in `runner.ts` from `state.activeSession.meta.sessionId`, like the
      `persona` keystone — NEVER a tool arg; verified unspoofable); verify
      `entry.parentId === context.activeSessionId`. **Cross-session release
      denied; a child cannot release its OWN deliverable** (its
      `activeSessionId` never equals the parent that owns the entry — only the
      consuming parent releases). On success call
      `workspaceReaper.dispose(subagentSessionId)` (destroys the container, then
      `rm`). Test: cross-session denied; self/sibling denied; parent dispose
      destroys container then removes dir.
- [ ] **Step 3: release/teardown close the resume window — including across a
      crash.** `dispose` already destroys the container before `rm`. Also **mark
      the job non-resumable** on dispose (scrub `previousJob.subagentSessionId`
      / set a `released` flag the resume check at `delegate.ts` honors) so an
      in-process `delegate(resume=…)` errors with "this delegation was released;
      start a fresh delegate." **AND** — because that flag is in-memory and a
      SIGKILL skips it — make the resume path **defensively gate on the
      workspace**: if the prior `subagentSessionId` resolves but
      `childWorkspaceDir(...)` is missing or empty, refuse resume with the same
      error instead of re-`mkdir`ing an empty `/work` (delegate's mkdir is
      idempotent → would otherwise resurrect a hollow workspace). Serialize
      release vs resume per childId with a **NEW mutex** — there is no existing
      per-childId lock (`per-invocation-reaper.ts` holds only timers); the
      WorkspaceReaper Map keyed by childId is the natural home. Test:
      resume-after-release errors (live flag); resume-after-crash errors
      (empty-workspace gate); concurrent release+resume drive both paths (assert
      no rm-of-live-mount and no hollow resurrection).
- [ ] **Step 4: clean-close backstop.** In `releaseRunningSessionWork`
      (`rpc/handlers/session.ts`, beside `killAllRunningJobs`/`clearJobs`),
      after the jobs are killed, call
      `workspaceReaper.releaseAllForParent(parentId)`. **Note
      `killAllRunningJobs` kills the subagent PROCESS, not the container** — so
      `dispose` (which `await`s `containerManager.destroy(specName)`) is what
      actually tears the container down here; the kill-first ordering is for the
      process, the container teardown is inside `dispose`. Fires on
      `session/close` and session-switch. Per-session (only the closing
      session's children; correct — this process owns them).
- [ ] **Step 5: per-process teardown.** A subagent-that-is-a-parent is SIGTERM'd
      by its parent and never gets `session/close`. In `shutdown()` (`main.ts`,
      SIGINT/SIGTERM/stdin-end), call
      `await workspaceReaper.releaseAllTracked()` — dispose everything _this_
      process tracks (containers destroyed + dirs removed), with **no parent-id
      argument** (the process can't know its parent; its own tracked entries are
      exactly what must be freed). Place it **first in the try block**, before
      any later `await` that can hang (the existing
      `shutdownReminders`/`mcpServerManager.shutdown()`), inside try/catch.
      (Belt; the Part 4 sweep is the SIGKILL backstop.)
- [ ] **Step 6: retention ceiling = per-parent COUNT**
      (`LACE_WORKSPACE_MAX_PER_PARENT`, generous default — high enough that
      normal fan-out width is never the binding constraint). On a new delegate
      that would exceed it: **fail the delegate** (never silently evict) with an
      error that **names the remedy precisely**: "N workspaces retained for this
      session; release a completed one with `release_delegation` before
      delegating again." Count is O(1) on the reaper Map — do NOT `du` bytes on
      the delegate hot path. Test: exceeding errors with the remedy text;
      dispose frees a slot. Commit.

## Part 4 — crash sweep (owner-pid + container-liveness gated)

- [ ] **Step 1: stand up the sweep.** There is no root-global scheduler to reuse
      (`ReminderScheduler` is session-bound). In `boot()` (`main.ts`):
      **`await runStartupReaper(...)` first** (it destroys all orphan `lace-*`
      containers), **then** run one sweep pass, **then** `setInterval` the
      sweep; clear the interval in `shutdown()`. Any lace process runs the same
      sweep — it is base-wide, idempotent, and doubly liveness-gated, so
      concurrent sweeps from multiple processes are safe (no "root" role).
- [ ] **Step 2: the sweep pass.** Build the **live-`/work` set**: list running
      `lace-*` containers and collect each one's `/work` bind source host-path
      (reuse the docker-listing the startup reaper uses,
      `containers/startup-reaper.ts`, extended to capture the bind source; or
      `containerManager`). Then for each top-level `<parentId>` dir under
      `resultsBase()`:
  - `if (ownerIsAlive(read .owner))` → **skip the whole subtree** (the owning
    live process will dispose its own children; its retained-but-container-gone
    workspaces are its to manage).
  - else (dead owner) → for each `<childId>` under it, **skip+log if
    `childWorkspaceDir(parentId,childId)` is in the live-`/work` set** (an
    orphaned-but-still-running container — leave it for `startup-reaper` at the
    next boot); otherwise
    `safeRemoveWorkspace(childWorkspaceDir(parentId,childId), resultsBase())`.
    Remove the now-(maybe-)empty `<parentId>` dir + its `.owner` only when no
    live-container children remain.
  - **Wrap each top-level subtree in its own try/catch** so one bad subtree
    can't abort the rest or crash the interval. After `startup-reaper`, the boot
    pass's live-`/work` set is empty → all dead-owner subtrees reclaim cleanly.
  - Confined to `resultsBase()` (disjoint from durable mounts per Part 2 Step
    0). Test: a live-owner subtree (own pid in `.owner`) is retained; a
    dead-owner subtree with NO live container is reaped; a dead-owner subtree
    WITH a live `lace-*` container holding its `/work` is skipped+logged; a
    recycled-pid/missing-`.owner` subtree is reaped (when no live container); a
    durable path is never in scope; a throw in one subtree doesn't abort the
    others. Commit.

## Part 5 — Ephemeral workdir + auto-cleaned `$TMPDIR` for every subagent

- [ ] **Step 1 (host subagent — needs its OWN injection site):**
      `job.executionEnv` is assembled **container-only** in `job-manager.ts`
      (inside the `containerExecutionContext ? … : {}` spread); a **host**
      subagent has no `containerExecutionContext`, so that block does NOT reach
      it. Set the host `$TMPDIR` at the host path: either set `job.executionEnv`
      unconditionally in `job-manager.ts` (new, non-container-gated) or inject
      at the host branch in `subagent-job.ts` where `executionEnv` is passed to
      `spawnSubagent` (consumed at `subagent-spawn.ts` via
      `env: {...process.env, ...executionEnv}`). Create a `mkdtemp` dir per
      subagent with an **opaque prefix** (e.g. `lace-tmp-` + the mkdtemp
      `XXXXXX`; do NOT prefix with a session id — the path leaks into the
      child's env and any logs the parent later reads). Remove it in the
      subagent-job exit `finally` (`subagent-job.ts`, beside
      `maybeScheduleReapAfter`).
- [ ] **Step 2 (container subagent):** `$TMPDIR` = a **tmpfs or a separate mount
      — NOT `/work/tmp`** (`/work` is the retained, parent-visible,
      ceiling-counted result tree; temp files must not land there). Injected via
      the existing container `executionEnv` path. Cleaned with the container.
- [ ] **Step 3:** Test: a subagent's `$TMPDIR` is isolated + removed on the
      normal/SIGTERM exit; the workspace (result) is NOT removed on exit;
      container temp is not under `/work`. **Caveat to document:** the host
      `$TMPDIR` `finally` does not run on SIGKILL, and `$TMPDIR` is under the OS
      temp root (NOT `resultsBase()`), so it is **not** covered by the Part 4
      sweep — on a hard crash it relies on OS temp cleanup. State this; don't
      claim unconditional cleanup. Commit.

## Part 6 — Result return points at the workspace (framed untrusted + possibly-incomplete)

- [ ] **Step 1:** The delegate result returns small results inline (as today)
      PLUS the workspace path (`<base>/<parentId>/<childId>`), for both
      background and sync modes, **framed as untrusted subagent output that is
      possibly-incomplete until the child job completes**, with a hint to
      `release_delegation` when done. Replace the bare scratchDir string. Test:
      result includes the workspace path + the untrusted/possibly-incomplete
      framing + the release hint. Commit.

---

## Known limitation (name it, don't hide it): mid-run disk exhaustion

The retention ceiling is checked at delegate time, but a child writes into
`/work` continuously — a malicious/runaway child can fill the host disk
**before** any ceiling check, DoSing all sessions. The real fix is a
**per-workspace size bound** (a size-limited tmpfs/loopback for `/work`, or an
fs quota) — out of scope for #5's lace-side work but **required before
adversarial multi-tenant use**; flag it as a hard pre-prod item alongside
#3/#4's gates. v1 (Ada-only, trusted code) accepts the risk.

## Self-review (rev 4)

- **BLOCKER (live-writer invariant was false) fixed:** the writer is the
  CONTAINER, which outlives the lace process. Every remove path (`dispose`)
  destroys the container + cancels its idle-reap before `rm`; the cross-process
  sweep gates on container liveness (live-`/work` set) on top of owner-pid
  liveness; the boot sweep runs after `startup-reaper`.
- **WorkspaceReaper carries `containerSpecName`** + late-bound
  `containerManager`/`perInvocationReaper` refs so `dispose` can tear the
  container down; `releaseAllForParent`/`releaseAllTracked` dispose per-entry
  (try/catch).
- **Remover is throw-safe at the top:** `rmdirSync` tolerant (warn, leave for
  next pass); per-entry continue-on-error; callers (sweep interval, teardown)
  wrap per subtree/entry.
- **Resume closes across a crash:** non-resumable flag (live) + empty-workspace
  gate (crash) — no hollow resurrection.
- **`/proc` field-22 parsed after the last `)`** (comm hazard); **`$TMPDIR` host
  site is separate** from the container-only `job-manager.ts` assembly;
  **`.owner` written before the first child mkdir** (create-gap);
  **`server-types.ts` at src root** (not `core/`).
- **Kept-sound (panel-verified):** no-root-role + per-process map; owner-pid
  signal; disjointness at initialize; 5-site wiring; three-valued enum;
  release-auth unspoofable; child can't forge `.owner`; persistent-box never
  reaped; remover walk escape-safe.

## Open items

- `LACE_WORKSPACE_MAX_PER_PARENT` default — pick generous (fan-out width must
  never be the binding constraint), document. Sweep interval default — minutes
  (it does a `docker ps`-class call per pass; not hot).
- Mid-run disk bound (per-workspace size cap) — pre-prod, out of #5's lace
  scope.
- A nested intermediate parent that SIGKILLs strands its grandchildren's
  workspaces + orphan containers until **either** the interval sweep (once the
  orphan container is gone) **or** the next boot's `startup-reaper`+sweep
  reclaims them. Accepted for Ada-only.
- In-flight per_invocation containers do NOT survive the scratch-path migration
  (Part 2) — acceptable per "no backward-compat for removed pre-v1 surfaces";
  drain or accept loss on deploy.
- `/proc`-based start-time nonce + container-liveness `docker ps` are
  Linux/Docker-specific — fine for the deploy target; note it if lace ever needs
  macOS-host support.
- Citation note: persistent-box opts out of the `lace-` reaper namespace via its
  **verbatim `containerId`** honored by `resolveContainerId`
  (`container-manager.ts`); the container startup reaper
  (`containers/startup-reaper.ts`, lists only `lace-*`) thus never sees it.
