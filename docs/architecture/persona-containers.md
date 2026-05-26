# Persona containers

> PRI-1796 reference. For the implementation plan see
> [`../superpowers/plans/2026-05-23-pri-1796-container-sharing-model.md`](../superpowers/plans/2026-05-23-pri-1796-container-sharing-model.md).

## The two sharing models

**`per_invocation`** — each fresh `delegate(persona=X, …)` call mints a new
subagent session and a new container. The container is isolated from all other
delegates, even concurrent ones of the same persona. A
`delegate(resume=jobId, …)` within the idle TTL window reuses the prior subagent
session and its container (same `/work`, same running processes). After the TTL
expires the container is reaped; the host scratch directory outlives it.

**`persistent`** — a single long-lived container named `sen-<persona>` (e.g.
`sen-box-shell`) survives process restarts and host reboots. All delegates exec
into the same container and see each other's filesystem state. This is
intentional: use `persistent` for personas that accumulate state across calls.

## Naming scheme

| Sharing model    | Docker container name                       |
| ---------------- | ------------------------------------------- |
| `per_invocation` | `lace-<parentSess8>-<persona>-<childSess8>` |
| `persistent`     | `sen-<persona>`                             |

`<parentSess8>` and `<childSess8>` are the first 8 characters of the respective
session ids with the `sess_` prefix stripped. The `lace-` prefix makes
per_invocation containers visible to the orphan reaper on startup; the `sen-`
prefix keeps persistent containers outside the orphan reaper's scope.

## Scratch dir convention

For `per_invocation` containers lace auto-injects a bind mount:

```
host:  /var/sen/instance/work/<childSessionId>/   (created with mode 0700)
guest: /work
```

The base path is overridable via `LACE_WORK_DIR`. The directory is created
before the container starts; on resume it already exists and keeps its contents.
The persona must NOT declare `mounts.scratch` — doing so is rejected at spawn
time with a `PersonaContainerSpecError`.

Persistent personas declare their own `/work` mount via the embedder's
container-mount registry (the `mounts.scratch` key in frontmatter). Lace does
not auto-inject `/work` for persistent containers.

The host scratch directory outlives the container. After the idle TTL reaps the
container, the directory stays on the host until the agent decides to clean it
up (see the GC reminder below).

## Idle TTL reap

Per_invocation containers are reaped 30 minutes after the child process exits. A
`delegate(resume=jobId, …)` arriving within the window cancels the pending reap
and reuses the container. The TTL is per subagent session (one timer per
container).

Override: `LACE_PER_INVOCATION_IDLE_TTL_MS` (milliseconds). Set to a small value
(e.g. `100`) in tests for fast assertions. Unset in production.

On lace startup the orphan reaper destroys any `lace-*` container not associated
with a live spec — this covers the case where lace crashed during a TTL window.

## R10 — adversarial-content scratch artifacts

Scratch directories written by per_invocation personas that browse the open web
(e.g. `browser-driver`) contain **adversarial content**: screenshots, HTML
extracts, and text from arbitrary third-party sites. These artifacts may include
prompt-injection attempts, deceptive layouts, or fabricated data. When the
parent agent reads them back, they must be treated as quoted material — not as
trusted analysis or recommendations.

## R6 — mount-conflict invariant

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

Reserved/auto-injected mount names (`persona`, `lace-data`, `credentials`,
`lace`, `scratch`) are excluded from the conflict check.
