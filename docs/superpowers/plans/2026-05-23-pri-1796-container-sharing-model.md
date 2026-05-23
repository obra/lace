# PRI-1796 Container Sharing Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `containerLifecycle: session | persistent` axis with a `containerSharing: per_invocation | persistent` axis, give per-invocation containers unique names + auto-mounted per-job scratch dirs, and enforce a configuration-time check that adversarial-content per_invocation personas cannot mount any host path shared with a persistent persona.

**Architecture:** Persona declares its sharing model. The host derives container names and scratch-dir paths from the model. Per-invocation containers are scoped to the **subagent session** (not the individual job): each new `delegate(persona=X)` without `resume=` mints a fresh subagent session and a fresh container; `delegate(resume=jobId)` reuses the prior subagent session and its container if still alive. The container is named `lace-<parentSess8>-<persona>-<childSess8>`, auto-mounts `/var/sen/instance/work/<childSessionId>/` to `/work`, and is reaped on a 30-minute idle TTL after the most recent child process exit (TTL cleared if a resume arrives). Persistent containers are named `sen-<persona>` (stable across restarts), survive process lifecycle, and accept concurrent exec from multiple delegates. The delegate tool resolves the subagent session id upfront (from `resume` arg or by minting), threads it through both the projected runtime binding and the job manager, and returns the host scratch path in its response so the parent agent can read child artifacts after the delegate finishes.

**Tech Stack:** TypeScript, Zod (persona schema), Vitest, existing `ContainerManager` and projected container runtime, existing delegate tool + job manager, Sen persona templates in `../sen-core-v2`.

---

## 1. Summary

Lace's current container runner names containers `lace-<session>-<persona>`, which collides on concurrent same-persona delegates (verified: `Conflict. The container name "/lace-sess_...-browser-driver" is already in use`). The `containerLifecycle: session | persistent` field is also misnamed — it conflates lifetime with concurrency. This kata replaces it with `containerSharing: per_invocation | persistent`, gives per-invocation containers names scoped to the subagent session (so concurrent delegates work AND `delegate(resume=...)` keeps its container), auto-mounts a per-subagent-session scratch dir so parents can read child artifacts, reaps per-invocation containers on a 30-minute idle TTL after the child exits (so resume within the window finds its container alive), and adds a configuration-time invariant check so per_invocation adversarial-content personas can't mount any host path also exposed to a persistent persona.

The `ada-sen-v2` host container rename to `sen-main` is OUT OF SCOPE — that's an infrastructure-layer change (Compose/DNS), filed as a separate follow-up.

## 2. Current state

### 2.1 Where container names are computed

- `packages/agent/src/jobs/persona-container-spec.ts:199–247` (`buildPersonaContainerSpec`): branches on `runtime.containerLifecycle`. For `session`, returns `spec.name = '${parentSessionId}-${personaName}'`. For `persistent`, returns `spec.name = 'box'` and the daemon-side `containerId = PERSISTENT_PERSONA_CONTAINER_ID` (`'sen-box'`, singleton constant).
- `packages/agent/src/containers/container-manager.ts:21–29` (`resolveContainerId`): if `spec.containerId` is set, returns it verbatim (so persistent containers escape the `lace-` namespace). Otherwise prefixes the spec name with `lace-`.
- `packages/agent/src/containers/docker-container.ts:68–92` (`resolveContainerName`): mirrors the same logic at the docker-CLI layer.

Net result: two concurrent delegates of the same persona from the same session both resolve to the exact same docker container name. Second one fails at `docker create` with name-already-in-use. Concurrent persistent delegates collide too — they both want the singleton `sen-box`.

### 2.2 What `containerLifecycle: session | persistent` means today

- `session` (`packages/agent/src/config/persona-registry.ts:43`, `:54`, `:120`): a lace-managed container per `(parent session, persona)` pair. Survives across delegates within the same Ada session. Reaped on agent restart by the orphan reaper (`container-manager.ts:229–263`). Persona declares `mounts.scratch: /work` and the embedder's container-mount registry maps `scratch` to a host path that's per-session-shared across all delegates.
- `persistent` (`persona-container-spec.ts:225–235`): a single daemon-side container named `sen-box`, restartPolicy `unless-stopped`, adopted across agent restarts via `daemonInspect` (`container-manager.ts:114`). No ports allowed (validation: `persona-registry.ts:118–128`). Multiple delegates exec into the same long-lived container — concurrency works for persistent today because adoption is idempotent.

### 2.3 Current concurrency behavior

- **Concurrent per_invocation (today: `session`)**: BROKEN. `ContainerManager.materialize` de-dupes concurrent materializations of the same spec name (`container-manager.ts:62–89`), so the second materialize call shares the first call's promise. The shared container is then used by both subagents — they trample each other's process tree, see each other's files, and inherit each other's env. From the spec's perspective this is silent state-sharing across what should be isolated invocations.
- **Concurrent persistent**: WORKS by accident. The singleton `sen-box` is adopted by both delegates, both exec into the same container, both see each other (which IS the intended persistent behavior).

### 2.4 Existing mount conventions

Persona files declare `runtime.mounts: { <name>: <containerPath> }`. The embedder's container-mount registry maps `<name>` to a host path. The persona-spec builder (`persona-container-spec.ts:70–192`) walks the persona's mount map and looks up each name in the registry, throwing on unknown names. Four reserved names exist already (`persona`, `lace-data`, `credentials`, `lace`) — these are auto-injected by lace at fixed in-container targets and rejected if declared by a persona.

Today's `scratch` mount points the persona-declared `/work` (or whatever) to a registry host path that's shared across all delegates of the persona within one Ada session. That's exactly the model PRI-1796 is replacing — for per_invocation personas, scratch needs to be unique per delegate call.

### 2.5 Per-invocation id source today

`delegate.ts:111–148` parses the persona, calls `buildPersonaProjectedRuntimeBinding` to build the runtime binding (using only `parentSessionId` + `personaName` — no per-invocation suffix), then calls `jobManager.createJob` which mints the job id. Result: the projected binding is built BEFORE the job id exists, so the container name has no per-invocation suffix to incorporate.

## 3. Target state (R1–R10 mapping)

**R1 (persona-level sharing declaration).** `packages/agent/src/config/persona-registry.ts` — rename `containerLifecycleSchema` to `containerSharingSchema` with values `per_invocation | persistent`. Rename the field in `runtimeContainerSchema` from `containerLifecycle` to `containerSharing`. Update the `superRefine` ports check to read `runtime.containerSharing === 'persistent'`. Update the field comment.

**R2 (per-invocation naming, subagent-session-scoped).** `packages/agent/src/jobs/persona-container-spec.ts` — `buildPersonaContainerSpec` accepts a new required `childSessionId` field on its input. For `containerSharing === 'per_invocation'`, spec name becomes `${parentSessionIdShort}-${personaName}-${childSessionIdShort}`. Each `*Short` is the first 8 chars of the session id with the `sess_` prefix stripped. Together with the `lace-` prefix added by `resolveContainerId`, the docker name becomes `lace-<parentSess8>-<persona>-<childSess8>`. Validate that all three components match `^[a-zA-Z0-9_-]+$` (existing pattern). The child session id source: `delegate.ts` reads from the `resume=` arg's resolved session for resume calls, or mints via `crypto.randomUUID()` for fresh delegates. Either way, the same child session id is passed both to `buildPersonaProjectedRuntimeBinding` and to `jobManager.createJob` (which uses it instead of minting its own when present).

**R3 (persistent container naming).** `packages/agent/src/jobs/persona-container-spec.ts` — remove the singleton `PERSISTENT_PERSONA_CONTAINER_ID = 'sen-box'` constant. For `containerSharing === 'persistent'`, spec name becomes the persona name (e.g. `box-shell`) and `containerId` becomes `sen-${personaName}` (e.g. `sen-box-shell`). The non-`lace-` prefix keeps persistent containers invisible to the orphan reaper, as today.

**R4 (concurrent persistent exec into same container).** No code change required. `ContainerManager.materialize` already shares one in-flight materialization for the same containerId (`container-manager.ts:62–89`), and the daemon-side adoption path (`adopt`) idempotently re-uses an already-running container. Verify with a new integration test (Test 3 below).

**R5 (per_invocation reap on idle TTL).** Per_invocation containers survive the subagent child's exit for a configurable TTL (default 30 minutes) so that `delegate(resume=jobId)` within the window finds its container alive. The TTL is per **subagent session** (i.e., per container), not per job. Implementation: a new `PerInvocationContainerReaper` (small class in `packages/agent/src/jobs/per-invocation-reaper.ts` or similar) owns a `Map<childSessionId, NodeJS.Timeout>`. Hooks:

- **On per_invocation child exit** (`subagent-job.ts` post-exit handler, all paths — success/failure/cancel): `reaper.scheduleReap(childSessionId, specName, ttlMs)`. Replaces any existing timer for that session.
- **On delegate spawn that targets an existing child session** (`delegate.ts`, when `resume=` resolves OR when a fresh per_invocation delegate happens to match an existing session id — should never collide but defensively): `reaper.cancelReap(childSessionId)`.
- **On lace shutdown**: best-effort `destroy` for all pending timers, or rely on the orphan reaper to clean up next start. The orphan reaper (`container-manager.ts:229–263`) handles the worst case where lace crashed mid-TTL — `lace-*` containers not in the live spec set get reaped on next boot.

The TTL value lives as a constant `PER_INVOCATION_IDLE_TTL_MS = 30 * 60 * 1000` in the reaper module. Override via env `LACE_PER_INVOCATION_IDLE_TTL_MS` for tests (set to 100ms or similar for fast assertions).

Mark the projected binding (or the job) with an explicit `containerSharing: 'per_invocation' | 'persistent'` discriminator (Q5 resolution: explicit field, not derived from spec shape) so the post-exit handler can read it without re-parsing the persona. The `--rm` flag on `docker create` is NOT used — we want lace to own teardown via `ContainerManager.destroy` so it can run lifecycle hooks and so the orphan reaper handles crashes.

**R6 (security invariant: cattle ≠ pets share host paths).** Two validators, both in `packages/agent/src/config/persona-registry.ts` (new module file: `packages/agent/src/config/persona-mount-conflict.ts`):

- **Warn at parse time.** `PersonaRegistry.listAvailablePersonas()` is extended with a `validateMountConflicts()` method called by the embedder at boot. It loads every persona, identifies the set of persistent personas' container-mount-registry names (e.g. `home`, `knowledge`), then checks every `per_invocation` persona's mount-registry names against that set. Any overlap is logged at WARN with `{persona, mountName, conflictsWith}`. Does NOT throw — a startup-hard-reject for a single bad persona is too high blast radius.
- **Reject at spawn.** `packages/agent/src/tools/implementations/delegate.ts` — before building the projected binding for a `per_invocation` persona, call `assertNoMountConflict(personaName, parsedPersona, registry)`. The function checks the same overlap rule and throws a `PersonaSharingViolationError` whose message names the persona, the offending mount name, the host path, and the persistent persona that also claims it. Delegate returns `status: 'failed'` with the error text — clean error on the actual delegate, no startup explosion. (The reserved/auto-injected mounts `persona`, `lace-data`, `credentials`, `lace`, `scratch` are excluded from the conflict check — they're lace-managed and not author-chosen overlaps.)

**R7 (concurrent main-Ada orchestration unchanged).** No code change beyond R2 (which fixes the broken case). Verify with the existing side-A / side-B smoke and the new concurrent-per_invocation test.

**R8 (clear failure mode for unsupported persistent concurrency).** Out of scope for this kata in practice — persistent personas accept concurrent exec by definition. If a future persistent persona's entrypoint can't accept a second client, surface the failure as the docker exec error it'll naturally throw. No code change.

**R9 (per-subagent-session scratch dir).** Three sites:

- `packages/agent/src/jobs/persona-container-spec.ts` — for per_invocation containers, auto-inject a mount `{source: '/var/sen/instance/work/<childSessionId>/', target: '/work', readonly: false}` BEFORE the loop that walks `runtime.mounts`. Add `scratch` to the reserved-name list in `resolvePersonaMountsAndEnv` — for `per_invocation` personas, declaring `mounts.scratch` is rejected (throws with a message pointing at this plan). For `persistent` personas, `mounts.scratch` continues to resolve via the embedder's containerMounts registry as today.
- `packages/agent/src/jobs/persona-container-spec.ts` — `buildPersonaContainerSpec` takes a new `scratchDirHostPath` input. The caller (`delegate.ts` via `buildPersonaProjectedRuntimeBinding`) is responsible for computing it from the child session id and a configurable base path (see "Host path layout" below). The spec builder does not assume a path layout; it just takes the value.
- `packages/agent/src/tools/implementations/delegate.ts` — sync mode response text and background mode JSON response BOTH include `scratchDir: '<hostPath>'`. Background mode response becomes `{ jobId, status: 'started', scratchDir }`. Sync mode prepends `delegate jobId=<id> scratchDir=<path>\n\n<output>`. On resume, the response carries the SAME scratch dir as the prior call (since it's keyed on child session id) — survival of the scratch dir across resumes is the whole point.

**Host path layout.** Base path is `process.env.LACE_WORK_DIR ?? '/var/sen/instance/work'`. Per-subagent-session dir is `<base>/<childSessionId>/`. The dir is created (mkdir -p) by lace on the host before the container starts; on resume the dir already exists (mkdir-p is idempotent). Permissions: 0700 owned by the lace process user, which matches sen-main's runtime user.

**GC.** Implemented in lace as a self-scheduled reminder owned by the delegate tool (see Section 7.5). The reminder fires periodically with a canonical prompt that nudges Ada to delegate a `shell` subagent to inspect and clean up. Lace doesn't do the rm — the agent does, exercising judgment about which dirs are still load-bearing. The lace-side path layout + `invocationId` correlation make dirs greppable so Ada can correlate to her job log.

**R10 (adversarial-content scratch is untrusted).** Documentation only. Add a stanza to `templates/agent-personas/browser-driver.md` (the canonical adversarial-content persona) reminding any consumer of its scratch dir to treat artifacts as quotation, not as trusted analysis. Mirrored in `docs/architecture/persona-containers.md` (create if absent — short, ~30 lines). No runtime code change.

## 4. Migration story

**Hard rename. No backward compatibility.**

Reasoning: there is exactly one deployed instance globally (Ada on sen-main). Wire-compat in the schema would mean carrying `containerLifecycle` as an alias of `containerSharing` indefinitely; aliases tend to outlive their need; the projection plan that just landed (`docs/superpowers/plans/2026-05-22-sen-container-projection-runtime-names.md`) sets the project's stance on compat parsers explicitly: "do not keep compatibility parsers, aliases, fallback names, or dual runtime discriminators." This kata follows the same stance.

Operational consequence: the sen-core-v2 persona templates and the lace schema must land on coordinated branches with the same name (`pri-1796-container-sharing`) on both repos. Merge ordering: sen-core-v2 first (so the next sen-upgrade picks up the new persona files), lace second (so the agent that reads them speaks the new schema). If the order is reversed, Ada parses the old field as unknown and the persona registry throws — caught at startup, fixed by deploying the matching lace.

One-time deploy step: `docker rm sen-box` on sen-main. The old singleton box-shell container will be orphaned when the new code names box-shell's container `sen-box-shell`. Add this to the kata's deploy notes / sen-upgrade.sh follow-up.

## 5. Persona template updates

All three changes happen in `../sen-core-v2/templates/agent-personas/` on a branch also named `pri-1796-container-sharing`. Create the sen-core worktree at implementation time; this plan enumerates the changes.

| File | Change | Justification |
|------|--------|---------------|
| `shell.md` | `containerLifecycle: session` → `containerSharing: per_invocation`. Remove `mounts.scratch: /work` (lace auto-mounts it now). Update the body text describing scratch persistence — it's now per-invocation, not session-shared. | Shell is a generic cattle worker. Each delegate gets a fresh scratch. The current "survives across delegates in the same Ada session" guarantee in the body is no longer true and would mislead the persona. |
| `browser-driver.md` | `containerLifecycle: session` → `containerSharing: per_invocation`. Remove `mounts.scratch: /work`. Add a stanza about scratch artifacts being adversarial output (R10). | Spec R5 (security): each adversarial-content invocation gets a fresh container. The mount removal matches `shell.md` rationale. |
| `box-shell.md` | `containerLifecycle: persistent` → `containerSharing: persistent`. Keep `mounts.scratch: /work` — for persistent personas, `scratch` continues to resolve via the embedder's registry as today (it's the shared `/work` all box-shell delegates see). Update body text where it says `sen-box` to say `sen-box-shell`. | Persistent personas keep the registry-resolved scratch mount. Container name follows the new R3 scheme. |
| `core.md`, `librarian.md`, `therapist.md` | No runtime block (they're `runtime.type: root`), no change needed. | These run in-process on the host, not in containers. |

## 6. R6 (security invariant) implementation

Module: `packages/agent/src/config/persona-mount-conflict.ts` (new). Exports two functions:

```typescript
// Used at delegate-spawn time. Throws PersonaSharingViolationError if the
// per_invocation persona declares a mount-registry name also claimed by any
// persistent persona. Reserved/auto-injected names are excluded.
export function assertNoMountConflict(
  personaName: string,
  parsed: ParsedPersona,
  registry: PersonaRegistry,
): void;

// Used at registry boot. Logs WARN for each violation. Never throws.
export function warnMountConflicts(registry: PersonaRegistry): void;
```

Both functions share a private `findConflicts(perInvocationPersonas, persistentPersonas)` helper that returns `{ persona, mountName, conflictsWith }[]`. The helper:
- Reads only container-runtime personas (skips `runtime.type: root`).
- Builds a `Map<mountName, Set<persistentPersonaName>>` from the persistent set.
- For each `per_invocation` persona, intersects its mount-name set with the keys of that map.
- Reserved mount names (`persona`, `lace-data`, `credentials`, `lace`, `scratch`) are filtered out before intersection — they're not author-chosen.

Error class:

```typescript
export class PersonaSharingViolationError extends Error {
  constructor(
    public readonly personaName: string,
    public readonly mountName: string,
    public readonly conflictsWith: string[],
  ) {
    super(
      `Per-invocation persona '${personaName}' declares mount '${mountName}', ` +
      `but the same mount name is also declared by persistent persona(s) ` +
      `[${conflictsWith.join(', ')}]. Per_invocation adversarial-content ` +
      `personas must not share host paths with persistent personas. Remove ` +
      `'${mountName}' from '${personaName}', or change one persona's ` +
      `containerSharing value.`,
    );
    this.name = 'PersonaSharingViolationError';
  }
}
```

`delegate.ts` calls `assertNoMountConflict(...)` after `parsePersona(persona)` returns successfully and BEFORE building the projected binding. On throw, the existing `PersonaParseError`-style catch in `delegate.ts:139–147` is extended to catch `PersonaSharingViolationError` and return `status: 'failed'` with the error text.

`warnMountConflicts(registry)` is called from the embedder's lace bootstrap (the same site that calls `personaRegistry.listAvailablePersonas()` at boot for logging). Specific call site to be located by the implementer; if no obvious site exists, add it to `packages/agent/src/server.ts` (or wherever `PersonaRegistry` is constructed in the entry path).

## 7. R9 scratch-dir implementation

### 7.1 Host path layout

```
/var/sen/instance/work/<childSessionId>/
```

`<childSessionId>` is the subagent session id (the same id used in the container name suffix and threaded to `jobManager.createJob`). The base path `/var/sen/instance/work` is overridable via `LACE_WORK_DIR` env (used by tests to mkdtemp; production reads the default).

The dir is created with mode 0700 by the embedder lace process on the host immediately before container materialization. On resume, mkdir-p succeeds idempotently and the dir contents from prior calls are still there. Owner is the lace process user (matches sen-main's runtime user). If the parent dir doesn't exist, create with the same mode.

### 7.2 Mount semantics

For `containerSharing: per_invocation` containers, `buildPersonaContainerSpec` auto-injects:

```typescript
mounts.push({
  source: scratchDirHostPath,            // /var/sen/instance/work/<inv>/
  target: '/work',
  readonly: false,
});
```

The target `/work` is hardcoded (no persona control). `mounts.scratch` is added to the reserved-name list in `resolvePersonaMountsAndEnv` — declaring it on a `per_invocation` persona throws `PersonaContainerSpecError` with a message pointing at this plan. For `persistent` personas, `mounts.scratch` is NOT reserved and continues to resolve via the embedder's container-mount registry as today.

The scratch dir is NOT auto-mounted on persistent containers. Persistent personas needing a `/work` mount declare it as today.

### 7.3 Child session id source

`delegate.ts` resolves the child session id BEFORE calling `buildPersonaProjectedRuntimeBinding` or `jobManager.createJob`:

- **Resume case** (`resume=jobId` was passed): look up the prior job's `subagentSessionId` (already done at `delegate.ts:160–184` — surface that value upward).
- **Fresh case** (no `resume=`): mint via `sess_${crypto.randomUUID().replace(/-/g, '')}` (matches lace's existing session id format). `jobManager.createJob` accepts a new `newSubagentSessionId` option to use this value instead of minting its own.

Threaded as:
1. Into `buildPersonaProjectedRuntimeBinding({ ..., childSessionId })`.
2. Into `jobManager.createJob('delegate', { ..., newSubagentSessionId, scratchDirHostPath })`.
3. Into `reaper.cancelReap(childSessionId)` for both resume and fresh cases (defensive — fresh sessions shouldn't have a pending reap, but it's idempotent).

Background delegate response includes the child session id and scratch dir:

```json
{ "jobId": "job_...", "subagentSessionId": "sess_...", "status": "started", "scratchDir": "/var/sen/instance/work/sess_..." }
```

The job id and child session id are distinct: a single subagent session can have many jobs (one per delegate call against that session, whether initial or resumed). Logs join them via the `job_started` event payload, which already includes both today.

### 7.4 GC

The delegate tool self-schedules a recurring GC reminder via lace's `ReminderScheduler` (`packages/agent/src/reminders/`). The reminder fires a prompt that nudges Ada to delegate a `shell` subagent to inspect `/var/sen/instance/work/` and clean up stale dirs. The judgment about which dirs are still load-bearing stays with the agent — lace just makes sure the reminder exists.

### 7.5 GC reminder wiring

**Where it lives.** `packages/agent/src/tools/implementations/delegate.ts`. On every per_invocation delegate (after the persona is parsed and confirmed `containerSharing: per_invocation`, before the binding is built), call a helper `ensureScratchGcReminder(reminderScheduler)` that:

1. Lists existing reminders via the per-session scheduler.
2. Looks for a reminder whose prompt starts with the sentinel `<scratch-gc>` (a fixed prefix in the canonical prompt text below).
3. If absent, schedules one with cron `0 6 * * *` (daily at 06:00 in the agent's timezone) — the cron-at-least-5-min assertion (`assertCronAtLeast5MinInterval`) already passes this trivially.
4. If present, no-op.

The helper short-circuits on its own session-scoped in-process flag (`hasEnsuredThisSession`) so it doesn't hit the scheduler on every delegate call. The flag is reset when the session changes.

**Reminder prompt.** The canonical prompt (exact text below; the `<scratch-gc>` prefix is the sentinel for the dedup check):

```
<scratch-gc>
Review the host directory /var/sen/instance/work/ for scratch dirs left behind by per_invocation delegates. Each subdir is named after a delegate's invocation id (inv_<22-hex>). Decide which can be removed — old artifacts you've already consumed, completed runs whose output is logged elsewhere, anything not load-bearing — and use delegate(persona='shell', prompt='rm -rf /var/sen/instance/work/<id> ...') to clean them up. Leave any dir whose contents you still need to read or pass to another subagent.
```

The prompt is intentionally judgment-oriented — no "older than 7 days" rule, no automatic deletion criteria. Ada decides. The reminder text lives as a constant in `delegate.ts` (or a small new file `packages/agent/src/tools/implementations/scratch-gc-reminder.ts` for cleanliness).

**Dependency wiring.** `delegate.ts` needs access to the per-session `ReminderScheduler`. The scheduler is bound per-session in `server.ts:192` and exposed via session state. Add `reminderScheduler?: ReminderScheduler` to `ToolContext` (or surface via an existing context field if one already plumbs scheduler access). If no obvious plumbing exists, add a context field — straightforward extension.

**Error handling.** If `ensureScratchGcReminder` throws (e.g., reminder store I/O fails), the delegate must still succeed. Wrap in try/catch and `logger.warn` the error. The GC reminder is best-effort safety net, not a critical path.

**Idempotency across processes.** Reminders persist in the ReminderStore (per-session SQLite-or-JSON, depending on the store implementation). After a lace restart, the existing reminder is still present, so the dedup check skips re-scheduling. The in-process `hasEnsuredThisSession` flag is reset on restart so the first delegate after restart re-confirms via the scheduler check.

## 8. Test plan

Mapping the spec's 7 verification scenarios to concrete tests. Note: per [[feedback-smoke-vs-tests]], integration tests against a local docker daemon are not the same as a production observation. The kata's done-criterion includes "smoke-check on Ada post-deploy" — fire one of each scenario (concurrent per_invocation, persistent CLI-install survival, scratch-dir read-back) and confirm the production behavior matches. The integration tests below verify the code paths; the post-deploy smoke verifies the deploy.

| # | Spec scenario | Test type | File | Test name | Assertion | Runs in CI? |
|---|---------------|-----------|------|-----------|-----------|-------------|
| 1a | Concurrent per_invocation (containers distinct) | Integration | `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts` | `builds distinct spec names for concurrent per_invocation invocations` | Two calls to `buildPersonaProjectedRuntimeBinding` with same `parentSessionId + personaName` but different `invocationId` produce distinct `spec.name` values | Yes |
| 1b | Concurrent per_invocation (containers actually spawn) | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` (new) | `spawns concurrent per_invocation containers without name collision` | Spawns two real `delegate(persona='browser-driver', ...)` calls in parallel against a live docker daemon, asserts both succeed and end up in distinct containers per `docker ps` | Integration (docker-gated) |
| 1c | Concurrent per_invocation (state isolation) | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `concurrent per_invocation containers have isolated filesystems` | Two concurrent per_invocation containers each write a marker file to `/work/marker`; from each container, the other's marker is absent (each gets its own host scratch dir) | Integration (docker-gated) |
| 2 | Sequential per_invocation (state isolation) | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `sequential per_invocation containers do not share state` | First container writes `/work/marker`; container is reaped; second container starts; `/work/marker` is absent | Integration (docker-gated) |
| 3 | Concurrent persistent (same container) | Integration | `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts` | `concurrent persistent invocations resolve to same containerId` | Two calls to `buildPersonaProjectedRuntimeBinding` for `containerSharing: persistent` produce identical `spec.containerId` (`sen-<persona>`) regardless of invocation id | Yes |
| 3-smoke | Concurrent persistent (process visibility) | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `concurrent persistent delegates exec into same container` | Two concurrent `delegate(persona='box-shell', ...)` calls; from inside each, `ps -ef` should show both subagent processes; file written by one immediately visible to the other | Integration (docker-gated) |
| 4 | Sequential persistent (state survives) | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `sequential persistent delegates share container state` | First delegate `touch /tmp/persist-marker` in `sen-box-shell`; second delegate `test -f /tmp/persist-marker` succeeds | Integration (docker-gated) |
| 5 | Security invariant (mount overlap) | Unit | `packages/agent/src/config/__tests__/persona-mount-conflict.test.ts` (new) | `warnMountConflicts logs overlap between per_invocation and persistent personas`; `assertNoMountConflict throws PersonaSharingViolationError naming the persistent persona` | Two synthetic personas with overlapping mount names produce a warning at parse and an error at spawn | Yes |
| 6 | Parent reads child scratch | Integration | `packages/agent/src/tools/implementations/__tests__/delegate.test.ts` | `delegate response includes scratchDir host path for per_invocation personas` | Background mode response is `{jobId, invocationId, status:'started', scratchDir}` with the host path resolvable; sync mode response prepends the path | Yes |
| 6-smoke | Same, end-to-end | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `parent reads child scratch dir from host after delegate completes` | `delegate(persona='shell', prompt='echo hello > /work/test.txt')`; after return, read `<scratchDir>/test.txt` from host filesystem, assert `hello` | Integration (docker-gated) |
| 7 | Scratch dir isolation (concurrent) | Unit | `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts` | `concurrent per_invocation scratch dirs are distinct` | Two `buildPersonaProjectedRuntimeBinding` calls with distinct invocation ids produce mount source paths with different `<invocationId>` segments | Yes |
| R5a | Per_invocation reap scheduled on child exit | Unit | `packages/agent/src/jobs/__tests__/subagent-job.test.ts` | `per_invocation child exit (success) schedules reaper`; `... failure schedules reaper`; `... cancel schedules reaper` | After `runSubagentJobProcess` returns, `reaper.scheduleReap(childSessionId, specName)` was called | Yes |
| R5b | Reaper actually destroys after TTL | Unit | `packages/agent/src/jobs/__tests__/per-invocation-reaper.test.ts` (new) | `scheduleReap fires destroy after TTL`; `scheduleReap replaces existing timer`; `cancelReap aborts pending destroy`; `dispose clears all pending timers` | Vitest fake timers; mock ContainerManager.destroy assertion | Yes |
| R5c | Resume cancels pending reap | Unit | `packages/agent/src/tools/implementations/__tests__/delegate.test.ts` | `resume cancels pending reaper for the child session id` | After `delegate(resume=jobId)`, `reaper.cancelReap(childSessionId)` was called | Yes |
| R5-smoke | Per_invocation container actually removed from docker after TTL | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `per_invocation container removed from docker after idle TTL` | Spawn delegate with `LACE_PER_INVOCATION_IDLE_TTL_MS=100`, observe container in `docker ps`, wait for delegate return + TTL+grace, observe container absent from `docker ps -a` (truly removed) | Integration (docker-gated) |
| Resume-1 | Resume within TTL reuses container + scratch | Integration | `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` | `resume within TTL exec's into same container` | Fresh per_invocation delegate writes to `/work/marker` and `/tmp/in-container`; wait for child exit (no TTL elapsed); resume; assert both files visible inside the resumed container | Integration (docker-gated) |
| Resume-2 | Resume after TTL gets a fresh container | Integration | same file | `resume after TTL spawns fresh container` | Same as Resume-1 but wait for TTL to elapse before resuming; assert `/tmp/in-container` absent (fresh container), `/work/marker` PRESENT (scratch dir survives — it's keyed on child session id, host-side) | Integration (docker-gated) |
| Naming | Schema rename | Unit | `packages/agent/src/config/__tests__/persona-registry.test.ts` | `parses containerSharing: per_invocation`; `parses containerSharing: persistent`; `rejects old containerLifecycle field`; `rejects per_invocation with ports on persistent rule applies to persistent only` | Schema accepts new field, rejects old field, ports validation now keys on `containerSharing === 'persistent'` | Yes |
| GC-1 | Scratch GC reminder is scheduled on first per_invocation delegate | Integration | `packages/agent/src/tools/implementations/__tests__/delegate.test.ts` | `delegate ensures scratch-gc reminder exists on first per_invocation call` | After a per_invocation delegate fires against a fake reminder scheduler, the scheduler has a reminder whose prompt starts with `<scratch-gc>` and recurs daily | Yes |
| GC-2 | Idempotency: second delegate doesn't re-schedule | Integration | same file | `delegate does not schedule duplicate scratch-gc reminders` | Fire two per_invocation delegates; scheduler still has exactly one reminder matching the sentinel | Yes |
| GC-3 | Failure of ensure-reminder doesn't break delegate | Integration | same file | `delegate succeeds even if reminder scheduling fails` | Fake scheduler throws on `schedule()`; delegate still creates the job and returns | Yes |
| GC-4 | Persistent delegate doesn't schedule the GC reminder | Integration | same file | `delegate does not schedule scratch-gc reminder for persistent personas` | A `containerSharing: persistent` delegate fires; scheduler has no scratch-gc reminder | Yes |

The "smoke" rows above are integration tests that need a live docker daemon, gated with the existing `hasDockerAvailable()` + `describe.skipIf(!DOCKER_AVAILABLE)` pattern from `packages/agent/src/containers/__tests__/docker-container.integration.test.ts`. They run automatically wherever docker is present (Ada, dev machines), skip silently in CI. No separate `scripts/` directory, no manual invocation step.

Suggested test file layout:

- `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts` — covers scenarios 1b, 1c, 2 (concurrent + sequential per_invocation), 3-smoke (concurrent persistent process visibility), 4 (sequential persistent state survives), R5-smoke (per_invocation reap actually happens), and 6-smoke (parent reads child scratch).

Each test in that file uses the shared `hasDockerAvailable()` helper. The "live sen-main" requirement reduces to "live docker" — the tests use real `node:24-bookworm` and `sen-box:dev` images, not Ada herself, so they pass anywhere docker is present.

## 9. Implementation chunks

Each chunk should land sequentially. Within a chunk, the implementer (with subagent-driven-development) decides task order.

### Chunk A: Schema rename

**Scope.** Rename `containerLifecycle` → `containerSharing` at the schema layer only. No naming or scratch-dir work yet.

**Tasks.**
- Edit `packages/agent/src/config/persona-registry.ts`: rename `containerLifecycleSchema` constant, rename `containerLifecycle` field in `runtimeContainerSchema`, rename values (`session` → `per_invocation`, `persistent` stays), update the `superRefine` ports check, update the field comment.
- Update every `containerLifecycle` reference in `packages/agent/src/` (grep located 27 sites: `persona-container-spec.ts`, `persona-projected-binding.ts`, `subagent-job.ts`, `delegate.ts`, plus their tests).
- Update test fixtures in: `persona-registry.test.ts` (14 occurrences), `persona-projected-binding.test.ts` (5), `persona-container-spec.test.ts` (3), `subagent-job-child-exit-propagation.test.ts` (1), `subagent-container-spawn.test.ts` (2), `delegate.test.ts` (various).

**Tests.** All existing tests pass after the rename. New test in `persona-registry.test.ts`: `rejects old containerLifecycle field with helpful error`.

**Commit boundary.** Ada is broken after this chunk lands until the sen-core-v2 persona files are also updated. The sen-core-v2 update is in Chunk B; chunks A and B must land in one deploy window. Mark Chunk A's commit with a "DO NOT DEPLOY WITHOUT CHUNK B" line in the message.

### Chunk B: Sen persona file updates

**Scope.** Update the three sen-core-v2 persona templates to the new schema. Field rename only; scratch-dir mount removal happens in Chunk D so this chunk can land independently.

**Tasks.**
- Edit `../sen-core-v2/templates/agent-personas/shell.md`: `containerLifecycle: session` → `containerSharing: per_invocation`.
- Edit `../sen-core-v2/templates/agent-personas/browser-driver.md`: same.
- Edit `../sen-core-v2/templates/agent-personas/box-shell.md`: `containerLifecycle: persistent` → `containerSharing: persistent`.
- Update test fixtures in `../sen-core-v2/tests/automated/templates/*.test.ts` and `tests/automated/instance/browser-driver-persona.test.ts` to mirror the new field.

**Commit boundary.** Commit on a `pri-1796-container-sharing` branch in sen-core-v2.

### Chunk C: Persistent container naming (R3)

**Scope.** Generalize the singleton `sen-box` constant to `sen-<persona>`. Stays a separate chunk so the rename and naming changes can be reviewed independently.

**Tasks.**
- `packages/agent/src/jobs/persona-container-spec.ts`: remove `PERSISTENT_PERSONA_CONTAINER_ID` constant. In the `containerSharing === 'persistent'` branch, compute `containerId = `sen-${personaName}``. Spec name becomes `personaName` (was `'box'`).
- Update `persona-container-spec.test.ts` persistent fixture expectations: `spec.name` is the persona name, `spec.containerId` is `sen-<persona>`.
- Update `delegate.test.ts` persistent fixture expectations the same way.
- Update `startup-reaper.test.ts` and `docker-container.test.ts` comments and fixtures referencing `sen-box`: change to `sen-box-shell` where the test exercises the box-shell persona; keep the orphan-protection rule unchanged (any non-`lace-` prefixed container survives the reaper).
- Add `docker rm sen-box` to the kata's deploy notes as a one-time cleanup step.

**Tests.** Existing tests updated; no new tests beyond the fixture updates.

### Chunk D: Per-invocation naming (R2) and scratch-dir auto-mount (R9 lace side)

**Scope.** Thread the child subagent session id through delegate → binding builder → spec builder. Auto-mount `/var/sen/instance/work/<childSessionId>/` to `/work` for per_invocation containers. Reject `mounts.scratch` on per_invocation personas. Return scratch dir host path and subagent session id in delegate response. Resume reuses the same child session id (and therefore the same container name + scratch dir).

**Tasks.**
- `packages/agent/src/tools/implementations/delegate.ts`: resolve `childSessionId` before persona handling. Lift the resume lookup (currently `delegate.ts:160–184`) earlier so the prior subagent session id is available before binding construction. For fresh delegates, mint `sess_${randomUUID-no-dashes}`. Pass to `buildPersonaProjectedRuntimeBinding({ ..., childSessionId })`. Compute `scratchDirHostPath = path.join(process.env.LACE_WORK_DIR ?? '/var/sen/instance/work', childSessionId)` for per_invocation personas only; pass it as an additional binding-builder input. `fs.mkdirSync(scratchDirHostPath, { recursive: true, mode: 0o700 })` (idempotent on resume). Pass `childSessionId` as `newSubagentSessionId` and `scratchDirHostPath` to `jobManager.createJob`. Update sync and background response shapes to include `scratchDir` and `subagentSessionId`.
- `packages/agent/src/jobs/persona-projected-binding.ts`: accept `childSessionId` and `scratchDirHostPath` inputs. Add `containerSharing: 'per_invocation' | 'persistent'` to the binding metadata (Q5 resolution). Pass them through to `buildPersonaContainerSpec`.
- `packages/agent/src/jobs/persona-container-spec.ts`: `buildPersonaContainerSpec` accepts `childSessionId` (required for per_invocation, ignored for persistent) and `scratchDirHostPath` (same). For per_invocation, spec name becomes `${parentSessionIdShort}-${personaName}-${childSessionIdShort}` where each `*Short` is the first 8 chars (with `sess_` prefix stripped) — validate component-by-component against the existing `SPEC_NAME_COMPONENT_RE`. Auto-inject the scratch mount (source=scratchDirHostPath, target=/work, readonly=false) for per_invocation containers. Add `scratch` to the reserved-mount-name list with a per-sharing-mode check (rejected only when `containerSharing === 'per_invocation'`).
- `packages/agent/src/jobs/job-manager.ts`, `job-creation.ts`, `server-types.ts`: add `newSubagentSessionId?`, `scratchDirHostPath?`, and `containerSharing?` to job state and creation options. `createJob` uses the supplied session id when present; otherwise mints as today.
- `packages/agent/src/tools/implementations/delegate.ts` (continued): create `ensureScratchGcReminder(reminderScheduler)` helper per Section 7.5 — list existing reminders, check sentinel `<scratch-gc>` prefix, schedule daily cron `0 6 * * *` if absent. Short-circuit on per-session in-process flag. Call from the per_invocation branch after binding is built, before `createJob`. Wrap in try/catch and log warn on failure.
- `packages/agent/src/tools/types.ts` (or wherever `ToolContext` is defined): add `reminderScheduler?: ReminderScheduler` field if not present. Locate scheduler-binding call in `server.ts:192` and surface it to the context for delegate tool execution.
- `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`: assert background response shape includes `subagentSessionId` and `scratchDir`. Assert sync mode prefix. Assert that resume reuses the prior subagent session id so container name and scratch dir are stable. Add tests GC-1 through GC-4 from Section 8.
- `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts`: test 1a (distinct spec names for concurrent per_invocation with different child session ids), test 7 (distinct scratch dirs), and a new test "resume reuses same spec name + scratch dir for same child session id."
- `packages/agent/src/jobs/__tests__/persona-container-spec.test.ts`: assert auto-injected scratch mount, assert rejection of `mounts.scratch` on per_invocation.

**Tests.** All listed above plus tests 3 (concurrent persistent same containerId, in `persona-projected-binding.test.ts`).

### Chunk E: Per-invocation idle TTL teardown (R5)

**Scope.** When a per_invocation delegate's subagent child exits, schedule the container for destruction after the idle TTL. If a resume arrives within the window, cancel the pending destruction.

**Tasks.**
- Create `packages/agent/src/jobs/per-invocation-reaper.ts`. Class `PerInvocationReaper` with `Map<childSessionId, { specName, timer }>` and three methods: `scheduleReap(childSessionId, specName, ttlMs?)` (cancels any existing timer for that session, then sets a fresh `setTimeout` that calls `containerManager.destroy(specName)`); `cancelReap(childSessionId)` (clears the timer if present, leaves the container alive); `dispose()` (clears all pending timers — called on lace shutdown). The reaper takes a `ContainerManager` and a logger in the constructor. Default TTL constant: `30 * 60 * 1000`. Env override: `LACE_PER_INVOCATION_IDLE_TTL_MS`.
- `packages/agent/src/jobs/subagent-job.ts`: in the post-exit handler (all paths: success/failure/cancel), if `job.containerSharing === 'per_invocation'`, call `reaper.scheduleReap(job.subagentSessionId, specName)`. Spec name is the binding's `toolRuntime.spec.name`. Failure to reap is logged at warn but does not propagate.
- `packages/agent/src/tools/implementations/delegate.ts`: after resolving `childSessionId` for any per_invocation delegate (both resume and fresh), call `reaper.cancelReap(childSessionId)`. Fresh sessions shouldn't have a pending timer; the call is idempotent and safe.
- Wire the singleton `PerInvocationReaper` into `server.ts` near where the `ContainerManager` is constructed, plumb to the delegate tool's `ToolContext` and to `subagent-job.ts`'s post-exit handler.
- New tests in `packages/agent/src/jobs/__tests__/per-invocation-reaper.test.ts`:
  - `scheduleReap fires destroy after TTL`
  - `scheduleReap replaces an existing timer for the same session`
  - `cancelReap stops a pending reap` (assert destroy not called)
  - `dispose clears all pending timers`
  - Use vitest fake timers (`vi.useFakeTimers()`) and a mock `ContainerManager`.
- New tests in `packages/agent/src/jobs/__tests__/subagent-job.test.ts` covering success/failure/cancel paths each calling `scheduleReap` for per_invocation. Use a mock reaper.
- New tests in `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`: `resume cancels pending reap for the child session id`.

### Chunk F: Security invariant (R6)

**Scope.** Add the mount-conflict validator. Wire it into parse-time warning and spawn-time rejection.

**Tasks.**
- Create `packages/agent/src/config/persona-mount-conflict.ts` with the two functions and the error class described in Section 6.
- Create `packages/agent/src/config/__tests__/persona-mount-conflict.test.ts` (test 5).
- Wire `warnMountConflicts(registry)` into the embedder bootstrap (locate the existing `personaRegistry.listAvailablePersonas()` call site at lace startup, or add to `server.ts`).
- Wire `assertNoMountConflict(...)` into `delegate.ts` after `parsePersona` succeeds, before building the projected binding.
- Extend the existing `PersonaNotFoundError | PersonaParseError` catch in `delegate.ts:139–147` to also catch `PersonaSharingViolationError`.

### Chunk G: Persona body text + docs

**Scope.** Update persona body text where the old session-shared scratch semantics are described. Remove `mounts.scratch` declarations from per_invocation personas. Document R10 in browser-driver.md and the architecture doc.

**Tasks.** (All in `../sen-core-v2`.)
- Edit `templates/agent-personas/shell.md`: remove `mounts.scratch: /work` line. Update body section "Scope and mounts" to describe `/work` as per-invocation rather than session-shared.
- Edit `templates/agent-personas/browser-driver.md`: remove `mounts.scratch: /work` line. Add a section on R10 (adversarial scratch artifacts are quotation).
- Edit `templates/agent-personas/box-shell.md`: rename references from `sen-box` to `sen-box-shell` in the body text.
- Update or add `docs/architecture/persona-containers.md` (in lace, not sen-core) with a short reference: sharing model, naming scheme, scratch dir convention, R10 reminder.

### Chunk H: Docker-gated integration tests

**Scope.** Create `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts`. Gate with the existing `hasDockerAvailable()` + `describe.skipIf(!DOCKER_AVAILABLE)` pattern. CI skips silently; Ada and any dev machine with docker runs them.

**Tasks.**
- New file with the docker-availability gate (copy the pattern from `packages/agent/src/containers/__tests__/docker-container.integration.test.ts:12–25`).
- Implement tests 1b, 1c, 2, 3-smoke, 4, 6-smoke, R5-smoke from the Section 8 table. Use the actual `node:24-bookworm` image for shell-equivalent tests and `sen-box:dev` for persistent-equivalent tests (if `sen-box:dev` is unavailable locally, the test should skip that single case with a clear message rather than fail).

Manual deploy verification step lives in the kata's done-criterion: after Chunk H lands AND the deploy goes out, fire one delegate of each kind on Ada and confirm via the same assertions the integration tests already check. No separate smoke-script binary.

### Chunk ordering and merge boundaries

- A (lace schema) and B (sen-core templates) must deploy together. Don't merge A without B ready to deploy minutes later.
- C (persistent naming) breaks the running `sen-box` container; deploy ordering: land code, then `docker rm sen-box`, then trigger any box-shell delegate to materialize `sen-box-shell` fresh. Box-shell `/home/agent` is bind-mounted from host so user state persists.
- D (per-invocation naming + scratch) is the meat. Must land AFTER A+B and AFTER C (which removes the singleton constant D would otherwise conflict with).
- E (teardown) is independent of D once D's binding metadata field is in place. Could land at the same time.
- F (R6) is independent — could land before or after D/E.
- G (docs/body text) lands with or after D — body text describes the new semantics.
- H (docker-gated integration tests) lands last; needs all of A–G live to actually pass.

Suggested order: A → B (paired deploy) → C → D + E (paired) → F → G → H.

## 10. Known tradeoffs

- **GC is judgment-driven, not policy-driven.** The reminder nudges Ada; the actual rm decisions belong to her. There's no "older than N days" rule. Trade: dirs survive longer than they would under a hard policy, and disk can fill if Ada ignores the reminder for weeks. Win: artifacts the parent is still using don't get yanked under it, and the cleanup pass adapts to context (e.g., during a long-running multi-step workflow, Ada keeps the dirs she's still passing through). Mitigation: monitoring on `/var/sen/instance/work/` size — out of scope here, can be added by an ops kata later.
- **Container reaped on idle TTL, not on exit.** Per_invocation containers survive 30 minutes after the child exits so `delegate(resume=jobId)` works. Trade: a per_invocation container that ends cleanly with no resume sticks around for 30 minutes consuming docker resources before reaping. Win: resume works the way users expect (continue an in-flight task without losing browser session / shell state). Tunable via `LACE_PER_INVOCATION_IDLE_TTL_MS` if 30 minutes is wrong.
- **Container scoped to subagent session, not job.** Multiple jobs against one subagent session (initial + resumes) share one container. Trade: the spec's framing was "per invocation," which could be read as "per job." We read it as "per delegate-tool-as-conversation" which makes resume coherent. Security R5 (browser-driver fresh container per call) still holds for non-resume cases: each new `delegate(persona=X)` without `resume=` mints a fresh subagent session and gets a fresh container.
- **Resume within TTL inherits container state.** Browser cookies, processes, anything the subagent set up survives the resume. For adversarial-content personas (browser-driver) this is the spec's R5 concern in principle — but the spec assumes "invocation" maps to the user's mental unit of work. Explicit resume is consented continuity; the threat model is unconsented state-carry between unrelated calls, which the fresh-session-per-fresh-delegate behavior still prevents.
- **`docker rm sen-box` is a manual deploy step.** Could be automated in sen-upgrade.sh but the cost of getting it wrong (deleting a running box-shell with state) is higher than the cost of running one `docker rm` by hand once. Implementer doesn't add automation here.
- **No `--rm` on docker create.** Lace owns the teardown via `ContainerManager.destroy` so it can run hooks and so the orphan reaper handles the crash-at-exit case. Spec R5 said "e.g., container run with --rm, or docker rm after docker stop" — we picked the latter, deliberately.
- **R6 validator is configuration-time only.** A persona file that ships with a violation gets WARNed at boot and rejected at spawn. The validator never runs against runtime input. If someone hand-edits a persona on the running host mid-session, the next delegate spawn picks up the change. Acceptable per spec ("This is a configuration constraint, not a runtime check").
- **Scratch dir target is hardcoded to `/work`.** Persona author cannot override. Saves a coordination point ("what if browser-driver picks `/screenshots` and shell picks `/work`?") and matches every current persona's existing choice. If a future persona genuinely needs a different target, lift the constant — but YAGNI for now.
- **Per_invocation persistent persona transition.** Today's running `sen-box` keeps running until manually removed. No persona file references it post-deploy (sen-core change renames the container). Risk: if `docker rm sen-box` is forgotten, the container runs unused, consuming RAM but no other harm.
- **The orphan reaper handles dropped per_invocation containers from crashed lace.** Existing code (`container-manager.ts:229–263`) scans `lace-*` containers and destroys those not in liveSpecNames. After this kata, per_invocation container names match `lace-<sess>-<persona>-<inv>` which the reaper handles correctly without modification.

## 11. Open questions for Jesse/Ada

1. **`sen-main` rename out of scope — confirm.** This plan treats `ada-sen-v2` as a separate infrastructure layer (Compose/DNS) and does not change it. Confirmed in brainstorm. Filed as follow-up kata: "Rename ada-sen-v2 host container to sen-main" — assignee/priority TBD.

2. **Reminder cadence and time.** RESOLVED: daily at 06:00 in the agent's timezone (`0 6 * * *`).

3. **R6 boot-time warn site.** RESOLVED: `packages/agent/src/server.ts`, near where `PersonaRegistry` is constructed. Implementer locates the exact line; if the obvious site isn't obvious, fall back to right after the registry is instantiated. One call site, fires once per process boot.

4. **Smoke script home.** RESOLVED: no separate smoke scripts. Docker-requiring scenarios are integration tests in `packages/agent/src/jobs/__tests__/persona-container-sharing.integration.test.ts`, gated with the existing `hasDockerAvailable()` + `describe.skipIf(!DOCKER_AVAILABLE)` pattern. Skip silently in CI, run automatically anywhere docker is present. Post-deploy verification on Ada is a manual one-off (fire one delegate of each kind), not a script invocation.

5. **R5 teardown discriminator + resume model.** RESOLVED: explicit `containerSharing` field on `RuntimeExecutionBinding` metadata (Q5 default option a). Per-invocation containers are reaped on a 30-minute idle TTL after child exit, NOT on exit itself — so `delegate(resume=jobId)` within the window finds its container alive. Container naming and scratch dir are keyed on the child subagent session id (not job id), so resume reuses both. See Sections 3 (R5 mapping), 7.1, 7.3, and Chunk E for the implementation. TTL default is overridable via `LACE_PER_INVOCATION_IDLE_TTL_MS` env (used by tests).

6. **Invocation id / child session id format.** RESOLVED: the naming key is the child subagent session id, which uses the existing `sess_${uuid-no-dashes}` format already used elsewhere in lace. No new id format introduced. The 8-char container-name suffix is `childSessionId.slice(5, 13)` (skipping the `sess_` prefix).

---

## Follow-up katas to file (not part of this plan)

- **PRI-XXXX:** Rename `ada-sen-v2` host container to `sen-main`. Compose/DNS/runbook change. Owner: infrastructure.
- **PRI-XXXX:** Add `--rm` semantics to spec R5 in v0.3 of PRI-1796 once Ada does the next spec pass (per her brainstorm note).
- **PRI-XXXX (optional):** Disk-pressure monitoring on `/var/sen/instance/work/` with alerting if size exceeds a threshold. Belt-and-suspenders for the GC reminder being judgment-driven rather than policy-driven.
