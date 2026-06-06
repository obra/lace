# Persona containers

## The two sharing models

**`per_invocation`** — each fresh `delegate(persona=X, …)` call mints a new
subagent session and a new projected tool container. The subagent lace process
runs on the host; its tools execute in the container. The container is isolated
from all other delegates, even concurrent ones of the same persona. A
`delegate(resume=jobId, …)` within the idle TTL window reuses the prior subagent
session and its container (same `/work`, same running processes). After the TTL
expires the shim reaps the container and removes `/work`.

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
per_invocation containers visible to the startup orphan reaper; the `sen-`
prefix keeps persistent containers outside the reaper's scope.

## Workspace convention (the workspace IS the result)

For `per_invocation` containers the sen-docker shim provisions a bind-mounted
workspace at a well-known path:

```
host:  <base>/<parentId>/<childId>/
guest: /work
```

`<base>` = `LACE_WORK_DIR` (default `os.tmpdir()/lace-work`); `<parentId>` is
the delegating session id, `<childId>` the subagent session id. The shim creates
and owns this directory — lace only computes the host path (via `childWorkspaceDir`)
so it can return the result path to the parent agent and track the entry in the
`WorkspaceReaper`.

Each child mounts ONLY its own subdir — mount-scoping, not file modes, is the
isolation boundary.

A container parent additionally gets `<base>/<parentId>` (its own children-results
base) bind-mounted read-only so its tools can read the workspaces it delegates.
The host root reads the tree directly.

The workspace **survives the disposable container** and is the child's deliverable
to the parent — returned by `delegate` framed as UNTRUSTED and
possibly-incomplete. The parent reclaims it with
**`job_kill(jobId, destroy_container=true)`** (the primary explicit release path).
Workspace reclamation also occurs on the parent's clean close and on process
teardown. A retention ceiling (`LACE_WORKSPACE_MAX_PER_PARENT`, default 128) fails
a fresh delegate that would exceed it — reclaim a completed one first.

Persistent personas declare their own `/work` mount via the embedder's
container-mount registry; lace does not auto-inject `/work` for them, and a
persistent box is never reaped.

## Lifecycle ownership: the shim owns per_invocation

The sen-docker shim owns the full per_invocation lifecycle:

1. **Create** — shim provisions the container and its `/work` at spawn time.
2. **Idle-TTL reap** — when no `exec` arrives within the TTL the shim destroys the
   container and removes `/work`.
3. **Release** — on an explicit release request the shim destroys the container
   and removes `/work` (the `release` verb).

lace's role is limited to:

- Computing the workspace path (a shared convention) to include in the delegate
  result and to track in-process.
- Enforcing the per-parent retention ceiling and the resume guard against
  released or empty workspaces.
- Routing teardown (`job_kill(destroy_container=true)` / clean-close /
  process teardown) through `WorkspaceReaper.dispose` →
  `ContainerManager.releasePerInvocation` → the plane `release` verb.

lace does NOT run a crash sweep, owner marker, or its own idle reaper. The shim
is the backstop for all orphan and idle cleanup.

## Ephemeral $TMPDIR

Every subagent gets an ephemeral, auto-cleaned `$TMPDIR` separate from `/work`
(which is the retained, parent-visible result tree). A **host** subagent gets a
`mkdtemp` host dir (opaque `lace-tmp-` prefix) on its process env, removed in the
job's exit `finally`. A **container** subagent gets `TMPDIR=/tmp` (the
container's own fs), set last so a persona cannot redirect temp into `/work`;
cleaned with the container.

## Host subagents are NOT a security boundary

A host child-process subagent runs as the same uid, inherits the parent's env and
workDir, and sees the whole host filesystem — it can read any sibling's workspace
and the session store. The ephemeral workdir + `$TMPDIR` are **hygiene, not
isolation**. Therefore **adversarial / untrusted / prompt-injectable work MUST
run as a `per_invocation` container persona, never as a host subagent.** A
container child is isolated by mount-scoping (only its own `/work`), so it cannot
read or plant a sibling's workspace.

## lace-ps: operator/debug visibility

The sen-docker shim exposes a `lace-ps` verb that lists running per_invocation
containers with their parent/child session ids and idle state. This is an
operator- and debug-facing view — lace itself tracks delegations in-process (the
retention ceiling and resume gate use the `WorkspaceReaper` in-memory map) and
does not consume `lace-ps` internally.

## Non-plane (local/docker) runtime

The per_invocation lifecycle features — idle-TTL reaping, `/work` removal on
release, and the `resultsBase`⟂mounts disjointness invariant — are provided by
the sen-docker shim and therefore apply **only on the plane runtime**. The
non-plane mode (plain Docker or local/host) is used for local development and
tests; it does not enforce the same isolation model and is not the production
configuration.

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
check. Other mount names, including the in-container agent support names
(`persona`, `lace-data`, `credentials`, `lace`), are ordinary persona-declared
mounts subject to the check.
