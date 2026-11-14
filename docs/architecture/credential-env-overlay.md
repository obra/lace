# Credential env overlay

An Ent host can mint a memory-only set of environment variables that every
tool call in the active session sees for the lifetime of the session (or a
shorter, explicit expiry). Use this to hand a freshly minted credential
placeholder to bash, ripgrep_search and other tool runtimes without ever
writing it to a session event, `state.json`, or any other on-disk location.
It is unrelated to [temporary request context](temporary-request-context.md)
(text appended to model requests) and distinct from `ent/session/configure`'s
`environment` field: `configure`'s `environment` is ordinary, general-purpose
session configuration that is written into the session's persisted config
(`state.json`) like `maxThinkingTokens` or `connectionId` — appropriate for
values that should survive a reload. The overlay described here is for
credential placeholders specifically: it never touches disk, it is scoped to
one live session, and it is designed to carry a value minted moments before
a tool call and gone again once that session ends.

After initializing the agent and activating a session, use these two RPCs:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "ent/session/env_overlay/set",
  "params": {
    "vars": { "GH_TOKEN": "sen-placeholder-captured-github-com-..." },
    "expiresAt": 1732500000000
  }
}
```

`vars` must be a nonempty object; every key must match
`^[A-Z_][A-Z0-9_]*$` (uppercase ASCII, digits and underscores, not starting
with a digit) and must not be a name on the dangerous-name denylist (below).
A call naming even one dangerous or malformed key is refused in full — no
partial application — and the error names the offending key(s), never any
value. `expiresAt` is an optional epoch-millisecond timestamp; omit it for an
entry that lives until explicitly cleared, the session ends, or the process
restarts. Set merges into the existing overlay; setting an already-present
key replaces its value and expiry.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "ent/session/env_overlay/clear",
  "params": { "keys": ["GH_TOKEN"] }
}
```

Omit `keys` (or pass `{}`) to clear the whole overlay. Both RPCs return `{}`
and require an active initialized session. Neither writes a durable event,
starts a turn, or is persisted to `state.json`.

## Name rules

Env var names in `vars` are shape-checked against
`^[A-Z_][A-Z0-9_]*$` and, separately, refused if they appear on (or match a
prefix on) lace's dangerous-name denylist
(`packages/agent/src/core/env-overlay.ts`'s `DANGEROUS_ENV_VAR_NAMES` /
`DANGEROUS_ENV_VAR_PREFIXES`, checked case-insensitively via
`isDangerousEnvVarName`). The denylist exists because the agent calling
`env_overlay/set` chooses the key name itself (e.g. from
`request_credential(verb: 'migrate', env: ...)`), so a name that controls
process/runtime behavior rather than delivering a credential to application
code — `PATH`, anything shaped `LD_*` (the dynamic loader's own env knobs,
not just `LD_PRELOAD`), `NODE_OPTIONS`, `GIT_SSH_COMMAND`, the proxy
variables (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, matched
case-insensitively so `http_proxy` is refused too), and the CA/TLS variables
(`SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`,
`REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`) — would hijack
every subsequent tool call in the session rather than just deliver a secret.
It is a deliberately fixed, extensible list, not a claim of completeness.

The shim lace's container runtime shells out through (`docker exec -e`) is
expected to pass credential env vars through unchanged — that delivery path
is configured on the sen-core side, not here — so this name guarding is the
only check standing between a model-chosen key and a hijacked process, and
it applies identically on every path (foreground tool calls, background
bash jobs, and the one-shot forward to a spawned subagent).

## Lifetime

The overlay belongs to the active session in this agent process. Successful
session `new`, `load`/`resume` activation, and `close` clear it — including
reloading the same session — exactly like `temporaryContext`. The `/new`
slash command (which creates a fresh session) also clears it. It is never
persisted, restored, or forked; a restarted process starts empty.

Every tool call reads the live overlay fresh, not a value captured once per
run or per turn: a credential minted mid-turn via `env_overlay/set` reaches
the very next tool call, and a credential cleared mid-turn stops reaching
calls after the clear. This applies to foreground bash/ripgrep_search calls
(`ToolContext.processEnv` and `createRuntime`'s `env`) and to `bash
background: true` jobs, which spawn through a separate code path
(`shell-job.ts`) and read the live overlay immediately before the process
actually starts.

A subagent is a separate lace process with its own in-memory
`AgentServerState`, so a parent's overlay is forwarded once, over the same
`env_overlay/set` RPC, immediately before the child's first prompt — subject
to the same name guarding and never-persisted guarantee. This is a one-shot
forward at spawn time, not an ongoing sync: a key minted on the parent AFTER
a child has already started is not pushed to it. The forward is unconditional
on the child's role — a credential minted for the parent reaches every child
it spawns regardless of whether that child's role is an intended reader of
it; this is a known open question, not resolved by this mechanism.

## Implementation and verification

`AgentServerState.envOverlay` owns the process-local map of
`{ [name]: { value, expiresAt? } }`. `core/env-overlay.ts` provides
`isDangerousEnvVarName` (shape case-insensitive denylist/prefix check used
alongside the RPC schema's `^[A-Z_][A-Z0-9_]*$` validation),
`pruneExpiredEnvOverlay` (drops expired entries in place) and
`liveEnvOverlay` (the pruned, flattened `{ name: value }` projection every
read site consults). The RPC handlers in
`rpc/handlers/session-operations.ts` validate shape and the denylist before
writing. The runner (`core/conversation/runner.ts`) re-reads the overlay
fresh inside `executeToolByName`, for every tool call; `shell-job.ts` reads
it immediately before spawning a background job's process; `server.ts`
wires both to `liveEnvOverlay(state)`. Session-end clearing lives alongside
every existing `temporaryContext = null` reset in
`rpc/handlers/session.ts` and `conversation/slash-commands.ts`.

Focused tests cover: the denylist and shape check (unit and over the RPC
boundary, including the malformed-key and dangerous-key refusal paths),
per-tool-call freshness inside a single run (three tool calls in one `run()`,
mutating the overlay between each, asserting absent → present → absent — not
just across separate `run()` calls, which a once-per-run cache would also
pass), background-job forwarding and its absence once the overlay is
cleared, and overlay clearing on session `new`, `load`, `close` and `/new`.
