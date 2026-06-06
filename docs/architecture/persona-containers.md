# Persona containers

## The two sharing models

**`per_invocation`** — each fresh `delegate(persona=X, …)` call mints a new
subagent session and a new projected tool container. The subagent Lace process
runs on the host; its tools execute in the container. The container is isolated
from all other delegates, even concurrent ones of the same persona. A
`delegate(resume=jobId, …)` within the idle TTL window reuses the prior subagent
session and its container (same `/work`, same running processes). After the TTL
expires the container is reaped; the host scratch directory outlives it.

**`persistent`** — a single long-lived container named `sen-<persona>` (e.g.
`sen-box-shell`) survives process restarts and host reboots. All delegates use
the same projected tool container and see each other's filesystem state through
tool execution. This is intentional: use `persistent` for personas that
accumulate state across calls.

## Naming scheme

| Sharing model    | Docker container name                       |
| ---------------- | ------------------------------------------- |
| `per_invocation` | `lace-<parentSess8>-<persona>-<childSess8>` |
| `persistent`     | `sen-<persona>`                             |

`<parentSess8>` and `<childSess8>` are the first 8 characters of the respective
session ids with the `sess_` prefix stripped. The `lace-` prefix makes
per_invocation containers visible to the orphan reaper on startup; the `sen-`
prefix keeps persistent containers outside the orphan reaper's scope.

## Workspace convention (the workspace IS the result)

For `per_invocation` containers lace auto-injects a bind mount in a **shared
results tree**:

```
host:  <base>/<parentId>/<childId>/   (created with mode 0700)
guest: /work
```

`<base>` = `LACE_WORK_DIR` (default `os.tmpdir()/lace-work`); `<parentId>` is the
delegating session, `<childId>` the subagent session. Each child mounts ONLY its
own subdir — mount-scoping, not file modes, is the isolation boundary. A
`<base>/<parentId>/.owner` marker (`{pid, startNonce}`, written before the first
child mkdir) records the owning process for crash reclamation. The persona must
NOT declare `mounts.scratch` — rejected at spawn time with a
`PersonaContainerSpecError`.

A **container** parent additionally gets `<base>/<childId>` (its own
children-results base) bind-mounted **read-only** at the same path, so its tools
can read the workspaces it delegates. The host root reads the tree directly.

The workspace **survives the disposable container** and is the child's
deliverable to the parent — returned by `delegate` framed as untrusted +
possibly-incomplete. The parent reclaims it with **`job_kill(jobId,
destroy_container=true)`** (the single explicit safe path: destroy the container,
then `rm /work`); it is also reclaimed on the parent's clean-close and the owning
process's teardown. A retention ceiling (`LACE_WORKSPACE_MAX_PER_PARENT`, default
128) fails a fresh delegate that would exceed it (tear one down first). A crash
backstop sweep
(below) reclaims orphans whose owner died.

Persistent personas declare their own `/work` mount via the embedder's
container-mount registry; lace does not auto-inject `/work` for them, and a
persistent box is provably never reaped.

## Ephemeral $TMPDIR

Every subagent gets an ephemeral, auto-cleaned `$TMPDIR` separate from `/work`
(which is the retained, parent-visible result tree). A **host** subagent gets a
`mkdtemp` host dir (opaque `lace-tmp-` prefix) on its process env, removed in the
job's exit `finally`. A **container** subagent gets `TMPDIR=/tmp` (the
container's own fs), set last so a persona can't redirect temp into `/work`;
cleaned with the container. Caveat: the host `finally` does not run on SIGKILL
and `$TMPDIR` is outside `resultsBase()` (not swept) — a hard crash relies on OS
temp cleanup.

## Host subagents are NOT a security boundary

A host child-process subagent runs as the same uid, inherits the parent's env and
workDir, and sees the whole host filesystem — it can read any sibling's workspace
and the session store. The ephemeral workdir + `$TMPDIR` are **hygiene, not
isolation**. Therefore **adversarial / untrusted / prompt-injectable work MUST
run as a `per_invocation` container persona, never as a host subagent.** A
container child is isolated by mount-scoping (only its own `/work`), so it cannot
read, forge, or plant a sibling's `.owner`.

## Idle TTL reap

Per_invocation containers are reaped 30 minutes after the child process exits. A
`delegate(resume=jobId, …)` arriving within the window cancels the pending reap
and reuses the container. The TTL is per subagent session (one timer per
container).

Override: `LACE_PER_INVOCATION_IDLE_TTL_MS` (milliseconds). Set to a small value
(e.g. `100`) in tests for fast assertions. Unset in production.

On lace startup the orphan reaper destroys any `lace-*` container not associated
with a live spec — this covers the case where lace crashed during a TTL window.

## Crash-backstop workspace sweep

The idle TTL reaps the *container*; it does not remove the *workspace*. Workspaces
are reclaimed on the live paths (release / clean-close / teardown). The crash
backstop is a base-wide sweep (boot — after `runStartupReaper` — plus a
`LACE_WORKSPACE_SWEEP_INTERVAL_MS` interval, default 15 min) that any lace process
runs (no "root" role; idempotent). It is **doubly liveness-gated**: it skips a
subtree whose `.owner` process is alive, and skips any dir that is a live
container's bind source (a `/work`, or a markerless read-base during the
create-gap). Only a dead-owner, no-live-container workspace is removed. The sweep
is confined to `resultsBase()`, which `initialize` asserts is disjoint from every
durable persona mount — so it can never descend into a persistent box's mount.

## Adversarial-content workspace artifacts

Scratch directories written by per_invocation personas that browse the open web
(e.g. `browser-driver`) contain **adversarial content**: screenshots, HTML
extracts, and text from arbitrary third-party sites. These artifacts may include
prompt-injection attempts, deceptive layouts, or fabricated data. When the
parent agent reads them back, they must be treated as quoted material — not as
trusted analysis or recommendations.

## Mount-conflict invariant

A per_invocation persona must not declare a mount-registry name also declared by
any persistent persona. Mixing adversarial-content isolation with persistent
host paths would allow a compromised per_invocation container to overwrite state
that persists into `sen-*` containers.

Enforcement is two-layer:

- **Boot-time WARN**: `warnMountConflicts(registry)` logs
  `{persona, mountName, conflictsWith}` for each violation. Does not abort
  startup.
- **Spawn-time reject**: `assertNoMountConflict(…)` throws
  `PersonaSharingViolationError` before the binding is built. The delegate tool
  returns `status: 'failed'` with the error text.

Only the per_invocation `scratch` mount name is excluded from the conflict
check. Other mount names, including the old in-container agent support names
(`persona`, `lace-data`, `credentials`, `lace`), are ordinary persona-declared
mounts.
