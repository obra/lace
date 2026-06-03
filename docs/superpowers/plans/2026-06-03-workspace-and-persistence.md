# Workspace + persistence (D4 / #5) Implementation Plan — rev 3

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development + superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`). Mostly **lace** (TypeScript, `packages/agent`), branch `pri2012-shim-lace`. Not box-coordinated like #3/#4. **#3 is already merged** — chase by symbol where the spec cites lines.

> **rev 3 (2026-06-03):** 3-opus panel on rev 2 found two architectural blockers + correctness/feasibility fixes. **(1) There is no "root process" role and the in-memory reaper map is per-process, not cross-reachable** — every agent (root + every subagent) is the same re-exec'd entrypoint; a process learns it is a subagent (and its parent) only *after* boot via the `session/new` RPC. So: the crash backstop is now a **base-wide, process-agnostic sweep**, and clean-close/SIGTERM **releases everything *this* process tracks** (`releaseAllTracked()`), not a parent-id key it cannot know. **(2) directory mtime is the wrong reclamation signal** (Linux dir mtime doesn't bump on writes into existing files/subdirs → a base-wide sweep could `rmdir` a *live* container's `/work`; a quiet child also evades). Replaced with **owner-pid liveness** (Jesse): each workspace-creating process drops a `.owner` marker (pid + `/proc` start-time nonce); the sweep skips live-owner subtrees and reaps dead-owner subtrees — no mtime guessing. Plus: disjointness check moved to **`initialize`-time** (containerMounts is empty at boot); the remover hardened (per-entry `lstat`, continue-on-error) under the new invariant **we never remove a live-writer workspace**; ToolContext threading is **5 sites** (rev 2 omitted the `ToolContext` interface declaration → compile wall); `toolRuntime.type` is **three-valued** (`host | boundedHost | container`); release marks the job **non-resumable**; per-childId release/resume **mutex must be added** (no existing lock); `$TMPDIR` injected where `executionEnv` is **assembled** (`job-manager.ts`), not where it's consumed.

> **Correction to the kit (kept from rev 1):** persistent-box STAYS a genuinely persistent container — `containerSharing` is NOT dissolved. A long-running batch job in a persistent box must never be reaped. #5 only (a) makes "persistent-box never reaped" an asserted invariant and (b) fixes the per_invocation work-product lifecycle.

**Goal:** A per_invocation subagent's **workspace is its result** — it survives the disposable container, is exposed to the parent via a shared results tree, and is reclaimed by **explicit release / parent clean-close / per-process teardown** (live path) or an **owner-pid-liveness sweep** (crash backstop) — never an idle/exit timer, never mtime. Plus: every subagent gets an ephemeral workdir + auto-cleaned `$TMPDIR`; the current scratch-dir leak is fixed; persistent-box is provably never reaped.

---

## Process topology (read first — it drives the whole design)
- **Every lace agent is the SAME re-exec'd entrypoint.** A subagent is spawned via `spawn(process.execPath, [process.argv[1]], …)` (`subagent-spawn.ts`) and runs the identical `boot()` (`main.ts`). **A process cannot know at boot whether it is "root" or a subagent, nor who its parent is** — that arrives later via the `session/new` `parent` param. Therefore the design has **no "root process" role**.
- **The in-memory `WorkspaceReaper` map is per-process** and tracks only the children *this* process created (the `delegate` tool runs in-process and mkdirs the child's workspace in the calling process). A nested grandchild's workspace lives only in the *intermediate* parent's process map — no other process can reach it in memory. Cross-process reclamation is therefore **filesystem-mediated** (the owner-pid-liveness sweep, Part 4), never via another process's map.
- A single process **may host multiple sessions** over its life (session-switch). It owns every workspace it created across all those sessions; on its own teardown it releases all of them (`releaseAllTracked()`).

## Security model (read second)
- **Container subagents are isolated by MOUNT-SCOPING, not file modes.** Each per_invocation child's container mounts **only its own** `<base>/<parentId>/<childId>` subdir at `/work`. Since all containers run as the same agent uid, `0700` is hygiene, NOT the boundary — the boundary is that a child's container spec never contains another child's path or the parent base. (Test that, not a cross-read.)
- **Host subagents are NOT a security boundary.** A host child-process subagent runs as the same uid, inherits the parent's env + workDir, sees the whole host fs — it can read any sibling's workspace and the session store. **Therefore: adversarial / untrusted / prompt-injectable work MUST run as a per_invocation *container* persona, never as a host subagent.** The plan gives host subagents an ephemeral workdir + `$TMPDIR` for hygiene, not cross-sibling isolation. State this in the persona docs.
- **Parent reads child output = untrusted input.** The parent (often the root coworker) reads child workspaces; a prompt-injected child writes arbitrary content there. The delegate result must frame the workspace as **untrusted subagent output** (like web/tool content), so the parent model doesn't treat child-written text as instructions.
- **Reads of a still-running child are possibly-incomplete.** A containerized parent's read-only base mount (Part 2 Step 3) exposes *all* its children, including ones still writing (background mode). A workspace is only **complete** once the child's job reports done. Frame it: read a child workspace as untrusted **and** as possibly-incomplete until the child's job has completed.
- **Invariant: we never remove a workspace that has a live writer.** Every remove path disposes/kills the owning child first — `release_delegation` disposes the live container before `rm` (Part 3 Step 3); clean-close kills jobs before releasing (Part 3 Step 4); the sweep only ever touches **dead-owner** subtrees (Part 4). So no remove races a live same-uid writer. Symlink-safety in the remover (Part 1 Step 3) is belt-and-suspenders against symlinks a child planted *before* it died.

## Decisions (Jesse, 2026-06-03)
- persistent-box stays persistent; `containerSharing` kept.
- Release = explicit tool (consuming parent only) + parent clean-close + per-process teardown sweep; retention ceiling = **per-parent count**.
- Crash/restart reclamation = **owner-pid-liveness sweep** (no persistent registry, no mtime). Each workspace-creating process drops a `.owner` marker; the base-wide sweep reaps dead-owner subtrees, skips live-owner ones.

---

## Part 1 — results-tree + owner marker + WorkspaceReaper (in-memory, LIVE only) + a symlink-safe, confined remover

**Files:** Create `jobs/results-tree.ts` + `jobs/workspace-reaper.ts`; wire the reaper onto `AgentServerState`.

- [ ] **Step 1: results-tree layout** (`results-tree.ts`):
  - `resultsBase()` = `process.env.LACE_WORK_DIR ?? path.join(os.tmpdir(), 'lace-work')` (match `delegate.ts`'s current `scratchBase`).
  - `childWorkspaceDir(parentId, childId)` = `<base>/<parentId>/<childId>`. **Both segments must be defined** — callers pass `context.activeSessionId ?? 'delegate'` for `parentId` (it is `string | undefined`; `delegate.ts` already uses this exact fallback) and the child **session** id for `childId`.
  - `ownerMarkerPath(parentId)` = `<base>/<parentId>/.owner`.
  - Unit-test: path layout, `..`-escape rejection (reject any id containing `/` or `..`), and that `childWorkspaceDir` always realpath-confines under `resultsBase()`.
- [ ] **Step 2: the owner marker** (`results-tree.ts`): `writeOwnerMarker(parentId)` — atomically (`write` to `<base>/<parentId>/.owner.tmp` then `rename`) writes `{ pid: process.pid, startNonce: readProcStartTime(process.pid) }` as JSON. `readProcStartTime(pid)` reads field 22 of `/proc/<pid>/stat` (the kernel's process start time — the anti-pid-recycle nonce). `ownerIsAlive(marker)` = `marker` parses **and** `process.kill(marker.pid, 0)` succeeds (ESRCH → dead) **and** `readProcStartTime(marker.pid) === marker.startNonce` (recycled-pid mismatch → dead). A missing/unparseable marker → **dead** (pre-v1 cruft or a failed create; safe to reclaim). Unit-test: own marker is alive; a fabricated `{pid: <unused>}` is dead; a pid-with-wrong-nonce is dead; missing file is dead.
- [ ] **Step 3: WorkspaceReaper** (in-memory `Map<childId,{parentId,path}>`, NO timers): `track`, `release(childId)` (confined remove, Step 4), `releaseAllForParent(parentId)`, `releaseAllTracked()` (release every entry — used on teardown, Part 3 Step 5), `list`. It governs LIVE sessions in this process only; crash recovery is the owner-pid sweep (Part 4), so `release` of an unknown id is a no-op (harmless — the sweep catches a forgotten one once this process dies).
- [ ] **Step 4: the confined, symlink-safe remover** (security-critical primitive). Under the live-writer invariant there is no concurrent writer, but the remover must still be symlink-safe (statically-planted links) and **continue-on-error** (one wedged entry must not abort reclamation of the rest):

```typescript
// Never follow a child-planted symlink out of the results base.
// Re-lstat every entry immediately before acting (do NOT trust readdir's cached
// dirent type), and never abort the whole sweep on one bad entry.
function safeRemoveWorkspace(path: string, base: string): void {
  const realBase = fs.realpathSync(base);
  const top = fs.lstatSync(path);                 // lstat: do not follow a symlinked top
  if (top.isSymbolicLink() || !top.isDirectory()) {
    fs.unlinkSync(path);                          // a symlink/file top: unlink, never recurse
    return;
  }
  const real = fs.realpathSync(path);
  if (real !== realBase && !real.startsWith(realBase + '/')) {
    throw new Error(`refusing to reap path outside results base: ${real}`);
  }
  for (const name of fs.readdirSync(real)) {       // names only — re-lstat each, no cached type
    const p = `${real}/${name}`;
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isDirectory()) fs.unlinkSync(p); // unlink follows nothing
      else safeRemoveWorkspace(p, realBase);                          // recurse only REAL dirs
    } catch (e) {
      logger.warn(`workspace-reaper: skipping ${p}: ${e}`);           // continue-on-error
    }
  }
  fs.rmdirSync(real);
}
```

Unit tests: retain-until-release; a child-planted symlink `<child>/x -> /home/jesse` is unlinked, its target untouched; a symlinked top dir is unlinked (not recursed); a path whose realpath escapes the base throws; release of unknown id is a no-op; a single un-removable entry is skipped and the rest are removed.
- [ ] **Step 5: place on `AgentServerState`** — construct eagerly in `createAgentServerState` (`server.ts`), no container dependency (cleaner than `perInvocationReaper`, which is constructed `null` and replaced in `main.ts`). Commit.
- [ ] **Step 6: assert persistent-box is never reaped** — a `persistent` job never schedules a container reap (`maybeScheduleReapAfter` early-returns on `containerSharing !== 'per_invocation'`, `subagent-job.ts`); the WorkspaceReaper never tracks a persistent box; the sweep (Part 4) is confined to `resultsBase()` which is disjoint from the box's durable mount (Part 2 Step 0). Test all three. Commit.

## Part 2 — Shared results tree (container mount-scoping is the boundary)

**Files:** `tools/implementations/delegate.ts` (the scratch-path computation, the `childSessionId!` join), `jobs/persona-container-spec.ts` (the `/work` mount source, line ~198 post-#3), `rpc/handlers/initialize.ts` (disjointness check).

- [ ] **Step 0: disjointness check at `initialize`-time (NOT boot).** `state.containerMounts` is empty at boot — it's populated by the `initialize` RPC. In the `initialize` handler, right after `state.containerMounts` is set, assert `realpath(resultsBase())` is **disjoint** from every `MountRegistryEntry.hostPath` realpath (neither equals nor nests either way), so the sweep can never descend into a durable persona mount. `mkdirSync(resultsBase(), {recursive:true})` first (realpath needs it to exist; compare normalized-absolute if realpath still throws). **Fail `initialize`** (not boot) on overlap. Unit-test the overlap predicate + the empty-at-boot fact.
- [ ] **Step 1:** In `delegate.ts`, replace the per_invocation scratch-path computation (today `scratchDirHostPath = path.join(scratchBase, childSessionId!)`) with `childWorkspaceDir(context.activeSessionId ?? 'delegate', childSessionId!)`; `mkdirSync(..., {recursive:true, mode:0o700})`; and `writeOwnerMarker(context.activeSessionId ?? 'delegate')` (idempotent; refreshes the marker each delegate). The child container still mounts **only this dir** at `/work` (the source path changes; the mount injection in `persona-container-spec.ts` is otherwise unchanged).
- [ ] **Step 2:** Track it in the WorkspaceReaper at delegate time (`track({childId: childSessionId, parentId: context.activeSessionId ?? 'delegate', path: scratchDirHostPath})`).
- [ ] **Step 3: parent read access.** Discriminant = `context.runtimeBinding?.toolRuntime.type`, which is **three-valued: `'host' | 'boundedHost' | 'container'`**. A **`container`** parent gets `<base>/<parentId>` mounted **read-only, once** at session start (a bind of the base dir — child subdirs created later appear live; it is NOT a snapshot). A **non-container** parent (`host` or `boundedHost` — the root coworker is `host`) reads `<base>/<parentId>` directly, no mount. Do not write `=== 'host'` (that strands `boundedHost`). Frame the read per the security model: untrusted **and** possibly-incomplete until the child job completes.
- [ ] **Step 4:** Isolation test = assert child A's resolved `ContainerSpec.mounts` contains ONLY A's `<childId>` path (never the base or a sibling) — NOT a cross-read test (that false-passes on single-uid CI). The spec→docker mount chain is 1:1 with no filtering (`projected-container.ts` → `docker-container.ts -v`), so the spec assertion is a valid proxy. Commit.

## Part 3 — Release: tool + clean-close + teardown sweep; count ceiling

- [ ] **Step 1: wire a `workspaceReaper` handle through to `ToolContext` — 5 sites** (rev 2 said 4 and omitted the interface declaration → a compile wall). Mirror `perInvocationReaper` exactly:
  1. `tools/types.ts` — add `workspaceReaper` to the **`ToolContext` interface** (this is the field the tool reads; `perInvocationReaper` is declared here ~line 67).
  2. `core/server-types.ts` — `AgentServerState` (beside the reaper handle from Part 1 Step 5).
  3. `rpc/handlers/prompt.ts` — `RunnerDependencies` assembly (~line 351).
  4. `core/conversation/types.ts` — deps (`perInvocationReaper` ~line 190).
  5. `core/conversation/runner.ts` — `ToolContext` assembly (~line 1664).
- [ ] **Step 2: `release_delegation` tool** — schema `{ subagentSessionId }`. **Register via the per-session path** (mirror `delegate` in `executor.ts registerAllAvailableTools` ~line 296), add its name to `PER_SESSION_BUILTIN_NAMES` (`builtins.ts`, today `{'delegate','use_skill'}`) and `LACE_BUILTIN_TOOL_NAMES` (`executor.ts`). Ownership: read `parentId` from `context.activeSessionId` (server-injected in `runner.ts`, like the `persona` keystone — NEVER a tool arg; verified server-side, unspoofable); verify `entry.parentId === context.activeSessionId`. **A child cannot release another session's child** (cross-session denied) and **a child cannot release its OWN deliverable** — only the consuming parent releases its children (so the producer can't destroy/empty the result before the parent reads it; enforced naturally because a child's `activeSessionId` never equals the parent that owns the entry). Test: cross-session release denied; self/sibling release denied; parent release succeeds.
- [ ] **Step 3: release must dispose the live container AND close the resume window.** Releasing a workspace `rm`s the `/work` mount source; if the per_invocation container is still alive (within its idle window), **destroy it first** (upholds the live-writer invariant). **Mark the job non-resumable** on release (clear/scrub the resumable handle or set a `released` flag) and make `delegate(resume=…)` return a clear "this delegation was released; start a fresh delegate" error — otherwise resume re-`mkdir`s an **empty** `/work` (delegate's mkdir is idempotent) and resurrects a hollow workspace. **Serialize release vs resume per childId with a NEW mutex** — there is no existing per-childId lock in `per-invocation-reaper.ts`; add one (the reaper Map keyed by childId is the natural home). Test: release after the container is gone (normal); release while alive (container destroyed first); resume-after-release errors; concurrent release+resume drive both paths (assert no rm-of-live-mount).
- [ ] **Step 4: clean-close backstop.** Add `releaseAllForParent(parentId)` to `releaseRunningSessionWork` (`rpc/handlers/session.ts`, beside `killAllRunningJobs`/`clearJobs` — which run first, so the children are dead before release) — fires on `session/close` and session-switch. (Per-session: releases only the closing session's children; correct because this process owns them.)
- [ ] **Step 5: per-process teardown sweep (covers nested parents).** A subagent-that-is-a-parent is SIGTERM'd by its parent's teardown and never gets `session/close`. In `shutdown()` (`main.ts`, SIGINT/SIGTERM/stdin-end), call **`workspaceReaper.releaseAllTracked()`** — release everything *this* process tracks, with **no parent-id argument** (the process cannot know its parent session, and its own tracked entries are exactly what must be freed). Place it early in `shutdown()` so it runs before any later `await` that could hang, and inside try/catch. (Belt; the owner-pid sweep is the final backstop for SIGKILL.)
- [ ] **Step 6: retention ceiling = per-parent COUNT** (`LACE_WORKSPACE_MAX_PER_PARENT`, generous default — set high enough that normal fan-out width is never the binding constraint). On a new delegate that would exceed it: **fail the delegate** (never silently evict) with an error that **names the remedy precisely**: "N workspaces retained for this session; release a completed one with `release_delegation` before delegating again." Count is O(1) on the reaper Map — do NOT `du` bytes on the delegate hot path. Test: exceeding errors with the remedy text; release frees a slot. Commit.

## Part 4 — owner-pid-liveness sweep (crash/restart reclamation backstop)
- [ ] **Step 1: base-wide, process-agnostic sweep.** Stand up a fresh `setInterval` in `main.ts` boot (there is no root-global scheduler to reuse — `ReminderScheduler` is session-bound), clear it in `shutdown()`. Run it once at boot and on the interval. **Any** lace process runs the same sweep — it is base-wide and idempotent + liveness-gated, so concurrent sweeps from multiple processes are safe (no "root" role). For each top-level `<parentId>` dir under `resultsBase()`: read `<parentId>/.owner`; if `ownerIsAlive(marker)` → **skip the whole subtree** (a live owner — including all its live children — is never touched); else `safeRemoveWorkspace(<parentId>, resultsBase())` (dead owner → orphan; reclaim). No mtime, no age. The sweep is confined to `resultsBase()` (disjoint from durable mounts per Part 2 Step 0) and only ever removes dead-owner subtrees (upholds the live-writer invariant). Test: a live-owner subtree (own pid in `.owner`) is retained; a dead-owner subtree (fabricated dead pid) is reaped; a recycled-pid (wrong nonce) subtree is reaped; a missing-`.owner` subtree is reaped; a durable path is never in scope. Commit.

## Part 5 — Ephemeral workdir + auto-cleaned `$TMPDIR` for every subagent
- [ ] **Step 1 (host subagent):** create a `mkdtemp` dir per subagent (opaque prefix, e.g. `lace-tmp-` + the mkdtemp `XXXXXX` suffix — do **not** prefix with a session id, since the path leaks into the child's env and any logs the parent later reads). Set `$TMPDIR` to it **where `executionEnv` is assembled** (`job-manager.ts`, where `job.executionEnv` is built — `subagent-spawn.ts` only *consumes* it via `env: {...process.env, ...executionEnv}`). Remove it in the subagent-job exit `finally` (`subagent-job.ts`, beside `maybeScheduleReapAfter`). This is ephemeral scratch — distinct from the retained workspace.
- [ ] **Step 2 (container subagent):** `$TMPDIR` = a **tmpfs or a separate mount — NOT `/work/tmp`** (`/work` is the retained, parent-visible, ceiling-counted result tree; temp files must not land there). Cleaned with the container.
- [ ] **Step 3:** Test: a subagent's `$TMPDIR` is isolated + removed on the normal/SIGTERM exit; the workspace (result) is NOT removed on exit; container temp is not under `/work`. **Caveat to document:** the host `$TMPDIR` `finally` does not run on SIGKILL, and `$TMPDIR` is under the OS temp root (NOT `resultsBase()`), so it is **not** covered by the Part 4 sweep — on a hard crash it relies on OS temp cleanup. State this; don't claim unconditional cleanup. Commit.

## Part 6 — Result return points at the workspace (framed untrusted + possibly-incomplete)
- [ ] **Step 1:** The delegate result returns small results inline (as today) PLUS the workspace path (`<base>/<parentId>/<childId>`), for both background and sync modes, **framed as untrusted subagent output that is possibly-incomplete until the child job completes**, with a hint to `release_delegation` when done. Replace the bare scratchDir string. Test: result includes the workspace path + the untrusted/possibly-incomplete framing + the release hint. Commit.

---

## Known limitation (name it, don't hide it): mid-run disk exhaustion
The retention ceiling is checked at delegate time, but a child writes into `/work` continuously — a malicious/runaway child can fill the host disk **before** any ceiling check, DoSing all sessions. The real fix is a **per-workspace size bound** (a size-limited tmpfs/loopback for `/work`, or an fs quota) — out of scope for #5's lace-side work but **required before adversarial multi-tenant use**; flag it as a hard pre-prod item alongside #3/#4's gates. v1 (Ada-only, trusted code) accepts the risk.

## Self-review (rev 3)
- **BLOCKER (no root role) fixed:** crash backstop is a base-wide, process-agnostic, liveness-gated sweep; no process needs to identify as root.
- **BLOCKER (per-process map) fixed:** teardown calls `releaseAllTracked()` (this process's own entries); nested grandchildren are released by their intermediate parent's teardown, and by the owner-pid sweep on SIGKILL.
- **Reclamation signal fixed:** owner-pid liveness (pid + `/proc` start-time nonce) replaces mtime — never reaps a live owner's subtree, always reclaims a dead owner's; recycled-pid and missing-marker handled.
- **Live-writer invariant** stated and upheld by ordering (release disposes container → rm; clean-close kills jobs → release; sweep only on dead owners); remover hardened (per-entry `lstat`, continue-on-error, symlink-safe, realpath-confined) as belt against statically-planted symlinks.
- **Disjointness check moved to `initialize`-time** (containerMounts empty at boot); fails `initialize` on overlap.
- **Wiring corrected to 5 sites** (added the `ToolContext` interface declaration in `tools/types.ts`); `release_delegation` via the per-session path + the two name lists; `activeSessionId` server-injected/unspoofable (verified).
- **`toolRuntime.type` three-valued** (`host|boundedHost|container`) — non-container reads direct.
- **release marks job non-resumable + per-childId mutex added** (no existing lock); ceiling error names the remedy (no fan-out deadlock confusion).
- **`$TMPDIR` injected at assembly (`job-manager.ts`)**, not under `/work`, opaque prefix, SIGKILL non-cleanup caveat stated.
- **Parent reads framed untrusted + possibly-incomplete-until-complete.**

## Open items
- `LACE_WORKSPACE_MAX_PER_PARENT` default — pick generous (fan-out width must never be the binding constraint), document.
- Mid-run disk bound (per-workspace size cap) — pre-prod, out of #5's lace scope.
- In-flight per_invocation containers do NOT survive the scratch-path migration (Part 2) — acceptable per "no backward-compat for removed pre-v1 surfaces"; drain or accept loss on deploy.
- `/proc`-based start-time nonce is Linux-only — fine for the deploy target (Linux box); note it if lace ever needs macOS-host support.
- Citation note: persistent-box opts out of the `lace-` reaper namespace via its **verbatim `containerId`** honored by `resolveContainerId` (`container-manager.ts`); the container startup reaper (`containers/startup-reaper.ts`, lists only `lace-*`) thus never sees it.
