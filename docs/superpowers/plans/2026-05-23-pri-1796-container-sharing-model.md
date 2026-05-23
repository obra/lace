# PRI-1796 Container Sharing Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `containerLifecycle: session | persistent` axis with a `containerSharing: per_invocation | persistent` axis, give per-invocation containers unique names + auto-mounted per-job scratch dirs, and enforce a configuration-time check that adversarial-content per_invocation personas cannot mount any host path shared with a persistent persona.

**Architecture:** Persona declares its sharing model. The host derives container names and scratch-dir paths from the model. Per-invocation containers are named `lace-<sess-short>-<persona>-<inv>` (unique per delegate call), auto-mount `/var/sen/instance/work/<inv>/` to `/work`, and are torn down with `--rm` on exit. Persistent containers are named `sen-<persona>` (stable across restarts), survive process lifecycle, and accept concurrent exec from multiple delegates. The delegate tool mints the invocation id upfront, threads it through both the projected runtime binding and the job manager, and returns the host scratch path in its response so the parent agent can read child artifacts after the delegate finishes.

**Tech Stack:** TypeScript, Zod (persona schema), Vitest, existing `ContainerManager` and projected container runtime, existing delegate tool + job manager, Sen persona templates in `../sen-core-v2`.

---

## 1. Summary

Lace's current container runner names containers `lace-<session>-<persona>`, which collides on concurrent same-persona delegates (verified: `Conflict. The container name "/lace-sess_...-browser-driver" is already in use`). The `containerLifecycle: session | persistent` field is also misnamed — it conflates lifetime with concurrency. This kata replaces it with `containerSharing: per_invocation | persistent`, gives per-invocation containers unique names so concurrent delegates work, auto-mounts a per-job scratch dir so parents can read child artifacts, tears down per-invocation containers on exit, and adds a configuration-time invariant check so per_invocation adversarial-content personas can't mount any host path also exposed to a persistent persona.

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

**R2 (per-invocation naming).** `packages/agent/src/jobs/persona-container-spec.ts` — `buildPersonaContainerSpec` accepts a new required `invocationId` field on its input. For `containerSharing === 'per_invocation'`, spec name becomes `${parentSessionIdShort}-${personaName}-${invocationIdShort}`. `parentSessionIdShort` is the first 8 chars of the session id stripped of any `sess_` prefix; `invocationIdShort` is the first 8 chars of the invocation id. Together with the `lace-` prefix added by `resolveContainerId`, the docker name becomes `lace-<sess8>-<persona>-<inv8>`. Validate that all three components match `^[a-zA-Z0-9_-]+$` (existing pattern).

**R3 (persistent container naming).** `packages/agent/src/jobs/persona-container-spec.ts` — remove the singleton `PERSISTENT_PERSONA_CONTAINER_ID = 'sen-box'` constant. For `containerSharing === 'persistent'`, spec name becomes the persona name (e.g. `box-shell`) and `containerId` becomes `sen-${personaName}` (e.g. `sen-box-shell`). The non-`lace-` prefix keeps persistent containers invisible to the orphan reaper, as today.

**R4 (concurrent persistent exec into same container).** No code change required. `ContainerManager.materialize` already shares one in-flight materialization for the same containerId (`container-manager.ts:62–89`), and the daemon-side adoption path (`adopt`) idempotently re-uses an already-running container. Verify with a new integration test (Test 3 below).

**R5 (per_invocation reap on delegate return).** `packages/agent/src/jobs/subagent-job.ts` — after the subagent child process exits (success, failure, or cancellation), if the job has a projected runtime binding whose toolRuntime spec was built from a `per_invocation` persona, call `ContainerManager.destroy(specName)` to stop and remove the container. `ContainerManager.destroy` already does stop+remove (`container-manager.ts:177–198`) so the implementation is one call site. The `--rm` flag on `docker create` is NOT used — we want lace to own the teardown so it can run lifecycle hooks (and so a crashed lace at exit-time doesn't leak — the orphan reaper picks it up next start). Mark the projected binding (or the job) with a `sharing: 'per_invocation'` discriminator so the teardown branch fires only for per_invocation. Carry the same discriminator through `JobState` so the post-exit handler can read it without re-parsing the persona.

**R6 (security invariant: cattle ≠ pets share host paths).** Two validators, both in `packages/agent/src/config/persona-registry.ts` (new module file: `packages/agent/src/config/persona-mount-conflict.ts`):

- **Warn at parse time.** `PersonaRegistry.listAvailablePersonas()` is extended with a `validateMountConflicts()` method called by the embedder at boot. It loads every persona, identifies the set of persistent personas' container-mount-registry names (e.g. `home`, `knowledge`), then checks every `per_invocation` persona's mount-registry names against that set. Any overlap is logged at WARN with `{persona, mountName, conflictsWith}`. Does NOT throw — a startup-hard-reject for a single bad persona is too high blast radius.
- **Reject at spawn.** `packages/agent/src/tools/implementations/delegate.ts` — before building the projected binding for a `per_invocation` persona, call `assertNoMountConflict(personaName, parsedPersona, registry)`. The function checks the same overlap rule and throws a `PersonaSharingViolationError` whose message names the persona, the offending mount name, the host path, and the persistent persona that also claims it. Delegate returns `status: 'failed'` with the error text — clean error on the actual delegate, no startup explosion. (The reserved/auto-injected mounts `persona`, `lace-data`, `credentials`, `lace`, `scratch` are excluded from the conflict check — they're lace-managed and not author-chosen overlaps.)

**R7 (concurrent main-Ada orchestration unchanged).** No code change beyond R2 (which fixes the broken case). Verify with the existing side-A / side-B smoke and the new concurrent-per_invocation test.

**R8 (clear failure mode for unsupported persistent concurrency).** Out of scope for this kata in practice — persistent personas accept concurrent exec by definition. If a future persistent persona's entrypoint can't accept a second client, surface the failure as the docker exec error it'll naturally throw. No code change.

**R9 (per-job scratch dir).** Three sites:

- `packages/agent/src/jobs/persona-container-spec.ts` — for per_invocation containers, auto-inject a mount `{source: '/var/sen/instance/work/<invocationId>/', target: '/work', readonly: false}` BEFORE the loop that walks `runtime.mounts`. Add `scratch` to the reserved-name list in `resolvePersonaMountsAndEnv` — for `per_invocation` personas, declaring `mounts.scratch` is rejected (throws with a message pointing at this plan). For `persistent` personas, `mounts.scratch` continues to resolve via the embedder's containerMounts registry as today.
- `packages/agent/src/jobs/persona-container-spec.ts` — `buildPersonaContainerSpec` takes a new `scratchDirHostPath` input. The caller (`delegate.ts` via `buildPersonaProjectedRuntimeBinding`) is responsible for computing it from the invocation id and a configurable base path (see "Host path layout" below). The spec builder does not assume a path layout; it just takes the value.
- `packages/agent/src/tools/implementations/delegate.ts` — sync mode response text and background mode JSON response BOTH include `scratchDir: '<hostPath>'`. Background mode response becomes `{ jobId, status: 'started', scratchDir }`. Sync mode prepends `delegate jobId=<id> scratchDir=<path>\n\n<output>`.

**Host path layout.** Base path is `process.env.LACE_WORK_DIR ?? '/var/sen/instance/work'`. Per-invocation dir is `<base>/<invocationId>/`. The dir is created (mkdir -p) by lace on the host before the container starts. Permissions: 0700 owned by the lace process user, which matches sen-main's runtime user.

**GC.** Out of scope for lace code in this kata. Ada's reminder/cron system fires a periodic prompt that delegates a `shell` subagent to inspect and clean up. Filed as a separate sen-core ticket (see Section 11). Lace code just makes the dirs greppable (consistent prefix and `<invocationId>` naming so Ada can correlate to her job log).

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
/var/sen/instance/work/<invocationId>/
```

`<invocationId>` is the 26-character lowercase id minted by the delegate tool (see Section 7.3). The base path `/var/sen/instance/work` is overridable via `LACE_WORK_DIR` env (used by tests to mkdtemp; production reads the default).

The dir is created with mode 0700 by the embedder lace process on the host immediately before container materialization. Owner is the lace process user (matches sen-main's runtime user). If the parent dir doesn't exist, create with the same mode.

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

### 7.3 Invocation id source

`delegate.ts` mints the invocation id BEFORE calling `buildPersonaProjectedRuntimeBinding` or `jobManager.createJob`. Format: `inv_${crypto.randomUUID().replace(/-/g, '').slice(0, 22)}` (26 chars total, `inv_` prefix + 22 hex chars). Threaded as:
1. Into `buildPersonaProjectedRuntimeBinding({ ..., invocationId })`.
2. Into `jobManager.createJob('delegate', { ..., invocationId, scratchDirHostPath })` so the job carries both fields (logged with `job_*` events, used by R5 teardown).

The container spec name uses `invocationId.slice(4, 12)` (the first 8 chars after the `inv_` prefix). Job id and invocation id remain separate values for clarity (job-id is what humans see in delegate output / job tooling; invocation-id is the container/scratch-dir naming key). Background delegate response includes both:

```json
{ "jobId": "job_...", "invocationId": "inv_...", "status": "started", "scratchDir": "/var/sen/instance/work/inv_..." }
```

Logs join the two via the `job_started` event payload.

### 7.4 GC

Not implemented in lace. Filed as separate sen-core ticket (Section 11). The lace-side path layout + `invocationId` correlation are sufficient for Ada to grep, judge, and `rm -rf` via a delegated `shell` subagent fired by her reminder system.

## 8. Test plan

Mapping the spec's 7 verification scenarios to concrete tests. Note: per [[feedback-smoke-vs-tests]], the unit/integration tests below verify the code paths in isolation; an Ada-side smoke MUST be re-run after deploy before declaring this kata closed.

| # | Spec scenario | Test type | File | Test name | Assertion | Runs in CI? |
|---|---------------|-----------|------|-----------|-----------|-------------|
| 1a | Concurrent per_invocation (containers distinct) | Integration | `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts` | `builds distinct spec names for concurrent per_invocation invocations` | Two calls to `buildPersonaProjectedRuntimeBinding` with same `parentSessionId + personaName` but different `invocationId` produce distinct `spec.name` values | Yes |
| 1b | Concurrent per_invocation (containers actually spawn) | Smoke | `packages/agent/scripts/smoke-concurrent-per-invocation.ts` (new) | n/a | Spawns two real `delegate(persona='browser-driver', ...)` calls in parallel against a live docker daemon, asserts both succeed and end up in distinct containers per `docker ps` | No — Ada-side only |
| 1c | Concurrent per_invocation (state isolation) | Smoke | same | n/a | Side A writes a localStorage marker; side B reads localStorage; B should NOT see A's marker | No — Ada-side |
| 2 | Sequential per_invocation (state isolation) | Smoke | same | n/a | Sequential `delegate(persona='browser-driver', ...)` calls; second call should see no state from first | No — Ada-side |
| 3 | Concurrent persistent (same container) | Integration | `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts` | `concurrent persistent invocations resolve to same containerId` | Two calls to `buildPersonaProjectedRuntimeBinding` for `containerSharing: persistent` produce identical `spec.containerId` (`sen-<persona>`) regardless of invocation id | Yes |
| 3-smoke | Concurrent persistent (process visibility) | Smoke | `packages/agent/scripts/smoke-concurrent-persistent.ts` (new) | n/a | Two concurrent `delegate(persona='box-shell', ...)` calls; from inside each, `ps -ef` should show both subagent processes; file written by one immediately visible to the other | No — Ada-side |
| 4 | Sequential persistent (state survives) | Smoke | same | n/a | First delegate installs a CLI; second delegate runs it. Confirms `sen-box-shell` survives across delegates (already works today for `sen-box`; verify after rename) | No — Ada-side |
| 5 | Security invariant (mount overlap) | Unit | `packages/agent/src/config/__tests__/persona-mount-conflict.test.ts` (new) | `warnMountConflicts logs overlap between per_invocation and persistent personas`; `assertNoMountConflict throws PersonaSharingViolationError naming the persistent persona` | Two synthetic personas with overlapping mount names produce a warning at parse and an error at spawn | Yes |
| 6 | Parent reads child scratch | Integration | `packages/agent/src/tools/implementations/__tests__/delegate.test.ts` | `delegate response includes scratchDir host path for per_invocation personas` | Background mode response is `{jobId, invocationId, status:'started', scratchDir}` with the host path resolvable; sync mode response prepends the path | Yes |
| 6-smoke | Same, end-to-end | Smoke | `packages/agent/scripts/smoke-scratch-roundtrip.ts` (new) | n/a | `delegate(persona='shell', prompt='echo hello > /work/test.txt')`; after return, read `<scratchDir>/test.txt` from host filesystem, assert `hello` | No — Ada-side |
| 7 | Scratch dir isolation (concurrent) | Unit | `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts` | `concurrent per_invocation scratch dirs are distinct` | Two `buildPersonaProjectedRuntimeBinding` calls with distinct invocation ids produce mount source paths with different `<invocationId>` segments | Yes |
| R5 | Per_invocation container reaped on exit | Integration | `packages/agent/src/jobs/__tests__/subagent-job.test.ts` | `per_invocation container destroyed after child exit (success)`; `... after child exit (failure)`; `... after child cancel` | After `runSubagentJobProcess` returns, `ContainerManager.destroy` was called with the spec name from the projected binding | Yes |
| R5-smoke | Same | Smoke | `packages/agent/scripts/smoke-per-invocation-reap.ts` (new) | n/a | Spawn delegate, observe container in `docker ps`, wait for delegate return, observe container absent from `docker ps -a` (truly removed, not just stopped) | No — Ada-side |
| Naming | Schema rename | Unit | `packages/agent/src/config/__tests__/persona-registry.test.ts` | `parses containerSharing: per_invocation`; `parses containerSharing: persistent`; `rejects old containerLifecycle field`; `rejects per_invocation with ports on persistent rule applies to persistent only` | Schema accepts new field, rejects old field, ports validation now keys on `containerSharing === 'persistent'` | Yes |

The smoke scripts go in `packages/agent/scripts/`. Each takes optional CLI args for the persona name / sample prompt and reports pass/fail to stdout. They require a live docker daemon and live sen-main; CI doesn't have either. The implementer ships them but the verification step on the kata is "run smokes on Ada, post results to #bot-debugging."

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

**Scope.** Thread an invocation id through delegate → binding builder → spec builder. Auto-mount `/var/sen/instance/work/<inv>/` to `/work` for per_invocation containers. Reject `mounts.scratch` on per_invocation personas. Return scratch dir host path in delegate response.

**Tasks.**
- `packages/agent/src/tools/implementations/delegate.ts`: mint `invocationId` (format `inv_${randomUUID-no-dashes-22chars}`) before persona handling. Pass to `buildPersonaProjectedRuntimeBinding({ ..., invocationId })`. Compute `scratchDirHostPath = path.join(process.env.LACE_WORK_DIR ?? '/var/sen/instance/work', invocationId)` for per_invocation personas only; pass it as an additional binding-builder input. `fs.mkdirSync(scratchDirHostPath, { recursive: true, mode: 0o700 })`. Pass `invocationId` and `scratchDirHostPath` to `jobManager.createJob`. Update sync and background response shapes to include `scratchDir` (and `invocationId` in background).
- `packages/agent/src/jobs/persona-projected-binding.ts`: accept `invocationId` and `scratchDirHostPath` inputs. Pass them through to `buildPersonaContainerSpec`.
- `packages/agent/src/jobs/persona-container-spec.ts`: `buildPersonaContainerSpec` accepts `invocationId` (required for per_invocation, ignored for persistent) and `scratchDirHostPath` (same). For per_invocation, spec name becomes `${parentSessionIdShort}-${personaName}-${invocationIdShort}` where each `*Short` is the first 8 chars (with `sess_`/`inv_` prefix stripped) — validate the result component-by-component against the existing `SPEC_NAME_COMPONENT_RE`. Auto-inject the scratch mount (source=scratchDirHostPath, target=/work, readonly=false) for per_invocation containers. Add `scratch` to the reserved-mount-name list with a per-sharing-mode check (rejected only when `containerSharing === 'per_invocation'`).
- `packages/agent/src/jobs/job-manager.ts`, `job-creation.ts`, `server-types.ts`: add `invocationId?` and `scratchDirHostPath?` to job state and creation options. Plumb through.
- `packages/agent/src/tools/implementations/__tests__/delegate.test.ts`: assert background response shape includes `invocationId` and `scratchDir`. Assert sync mode prefix.
- `packages/agent/src/jobs/__tests__/persona-projected-binding.test.ts`: test 1a (distinct spec names for concurrent per_invocation), test 7 (distinct scratch dirs).
- `packages/agent/src/jobs/__tests__/persona-container-spec.test.ts`: assert auto-injected scratch mount, assert rejection of `mounts.scratch` on per_invocation.

**Tests.** All listed above plus tests 3 (concurrent persistent same containerId, in `persona-projected-binding.test.ts`).

### Chunk E: Per-invocation teardown (R5)

**Scope.** When a per_invocation delegate's subagent exits, lace tears down its container.

**Tasks.**
- `packages/agent/src/jobs/subagent-job.ts`: in the post-exit handler (regardless of success/failure/cancellation), if the job has a per_invocation projected binding, call `containerManager.destroy(specName)`. Discriminator can be derived from the binding's spec (per_invocation = no `containerId` field present; persistent = `containerId` starts with `sen-`) — but simpler to add an explicit `containerSharing: 'per_invocation' | 'persistent'` field on the projected binding's metadata. Add the field to `RuntimeExecutionBinding` (or carry on `JobState`).
- New tests in `packages/agent/src/jobs/__tests__/subagent-job.test.ts` covering success/failure/cancel paths. Use a mock ContainerManager and assert `destroy(specName)` was called.

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

### Chunk H: Smoke scripts

**Scope.** Ship the 5 smoke scripts in `packages/agent/scripts/`. CI does not run them; they're invoked manually on Ada post-deploy.

**Tasks.**
- `smoke-concurrent-per-invocation.ts`
- `smoke-concurrent-persistent.ts`
- `smoke-scratch-roundtrip.ts`
- `smoke-per-invocation-reap.ts`
- (Optional: `smoke-mount-conflict.ts` exercising R6 against a synthetic bad-config persona.)

Each script: takes a delegate runtime config via env, fires the delegate(s), inspects docker state via `docker ps -a`, prints PASS/FAIL with the relevant docker context on failure.

### Chunk ordering and merge boundaries

- A (lace schema) and B (sen-core templates) must deploy together. Don't merge A without B ready to deploy minutes later.
- C (persistent naming) breaks the running `sen-box` container; deploy ordering: land code, then `docker rm sen-box`, then trigger any box-shell delegate to materialize `sen-box-shell` fresh. Box-shell `/home/agent` is bind-mounted from host so user state persists.
- D (per-invocation naming + scratch) is the meat. Must land AFTER A+B and AFTER C (which removes the singleton constant D would otherwise conflict with).
- E (teardown) is independent of D once D's binding metadata field is in place. Could land at the same time.
- F (R6) is independent — could land before or after D/E.
- G (docs/body text) lands with or after D — body text describes the new semantics.
- H (smokes) lands last; needs all of A–G live to actually pass.

Suggested order: A → B (paired deploy) → C → D + E (paired) → F → G → H.

## 10. Known tradeoffs

- **No GC in lace.** Disk fills if Ada's reminder doesn't fire. Trade: keeps the lace process boundary clean (no background timer) and puts the cleanup judgment in Ada's prompt where every other judgment-policy lives. Risk: if Ada's reminder breaks or she ignores it, scratch dirs accumulate forever. Mitigation: the reminder ticket (Section 11) is a hard requirement before declaring this kata fully done.
- **Invocation id != job id.** They could be unified (job id IS the invocation id) but that requires `JobManager.createJob` to expose a "reserve job id" step before full creation. The plan keeps them separate to avoid that refactor — they're correlated via the `job_started` event payload. Trade: one extra value to read in logs. Win: smaller plumbing change.
- **`docker rm sen-box` is a manual deploy step.** Could be automated in sen-upgrade.sh but the cost of getting it wrong (deleting a running box-shell with state) is higher than the cost of running one `docker rm` by hand once. Implementer doesn't add automation here.
- **No `--rm` on docker create.** Lace owns the teardown via `ContainerManager.destroy` so it can run hooks and so the orphan reaper handles the crash-at-exit case. Spec R5 said "e.g., container run with --rm, or docker rm after docker stop" — we picked the latter, deliberately.
- **R6 validator is configuration-time only.** A persona file that ships with a violation gets WARNed at boot and rejected at spawn. The validator never runs against runtime input. If someone hand-edits a persona on the running host mid-session, the next delegate spawn picks up the change. Acceptable per spec ("This is a configuration constraint, not a runtime check").
- **Scratch dir target is hardcoded to `/work`.** Persona author cannot override. Saves a coordination point ("what if browser-driver picks `/screenshots` and shell picks `/work`?") and matches every current persona's existing choice. If a future persona genuinely needs a different target, lift the constant — but YAGNI for now.
- **Per_invocation persistent persona transition.** Today's running `sen-box` keeps running until manually removed. No persona file references it post-deploy (sen-core change renames the container). Risk: if `docker rm sen-box` is forgotten, the container runs unused, consuming RAM but no other harm.
- **The orphan reaper handles dropped per_invocation containers from crashed lace.** Existing code (`container-manager.ts:229–263`) scans `lace-*` containers and destroys those not in liveSpecNames. After this kata, per_invocation container names match `lace-<sess>-<persona>-<inv>` which the reaper handles correctly without modification.

## 11. Open questions for Jesse/Ada

1. **`sen-main` rename out of scope — confirm.** This plan treats `ada-sen-v2` as a separate infrastructure layer (Compose/DNS) and does not change it. Confirmed in brainstorm. Filed as follow-up kata: "Rename ada-sen-v2 host container to sen-main" — assignee/priority TBD.

2. **GC ticket scope.** Section 7.4 defers GC to a sen-core ticket: "Ada-side reminder fires periodic cleanup of `/var/sen/instance/work/`." Implementer should file this ticket immediately after Chunk D lands, since the disk-fill clock starts ticking on first per_invocation delegate. Reminder content (cadence, prompt text, retention policy) is Ada's prompt-corpus decision, not lace's.

3. **R6 boot-time warn site.** The plan calls for `warnMountConflicts(registry)` at embedder boot but doesn't pin down the exact call site (because the brief explicitly asked NOT to do heavy source exploration past planning). Implementer should locate it; if no obvious site exists, add to `packages/agent/src/server.ts` near where `PersonaRegistry` is constructed. Flagged so the implementer doesn't silently skip the warn path.

4. **Smoke script home.** `packages/agent/scripts/` is the assumed location for the new smoke scripts. If sen-core has a more conventional `scripts/smoke/` directory, prefer that. Implementer's call after surveying.

5. **R5 teardown discriminator.** The plan suggests adding `containerSharing` to `RuntimeExecutionBinding` metadata (or `JobState`) so the teardown branch doesn't need to re-parse the persona. The field could instead be derived from the spec shape (`spec.containerId?.startsWith('sen-')` ⇒ persistent). I prefer the explicit field for clarity, but the implementer may collapse if it cleans up the type. Either is acceptable.

6. **Invocation id format.** The plan picks `inv_${22-hex}` (26 chars total). This is consistent with `job_${uuid}` and `sess_${uuid}` patterns the codebase already uses. If there's a preference for shorter (e.g. `inv_${8-hex}`) implementer should flag — the 8-char suffix in the docker name uses only the first 8 chars regardless, so this is mostly a logging-correlation choice.

---

## Follow-up katas to file (not part of this plan)

- **PRI-XXXX:** Rename `ada-sen-v2` host container to `sen-main`. Compose/DNS/runbook change. Owner: infrastructure.
- **PRI-XXXX:** Ada reminder for per-invocation scratch GC. Sen-core ticket; reminder prompt + cadence; out-of-band of lace.
- **PRI-XXXX:** Add `--rm` semantics to spec R5 in v0.3 of PRI-1796 once Ada does the next spec pass (per her brainstorm note).
