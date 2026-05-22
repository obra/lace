# PRI-1754 — Investigation: lace spawns deleted scheduler.ts MCP server

## Symptom recap

After PRI-1744 deleted `mcp-servers/scheduler.ts` from sen-core, Ada's lace
crash-loops on session/resume:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/var/sen/instance/system/sen-core/mcp-servers/scheduler.ts'
```

Stub `scheduler.ts` on Ada's disk masks the crash but doesn't survive a
`git reset --hard` of her instance root.

## Root cause

There are **two `state.json` files** for the same `sess_1fb52f85-...` session
on Ada's host:

| Path | nextEventSeq | mcpServers |
|------|-------------:|------------|
| `/mnt/data/ada-sen-v2/state/history/lace/agent-sessions/sess_.../state.json` | 96 | 4 entries, no scheduler |
| `/mnt/data/ada-sen-v2/history/lace/agent-sessions/sess_.../state.json` | 323 | **5 entries, including scheduler** |

The initial investigation looked at the first path (under `state/history/`) and
verified it was clean. But lace actually reads from the second path
(`history/lace/agent-sessions/` directly under instance root, no `state/`
prefix), via the default `getLaceDir()` resolution inside the container, where
the mount is `/var/sen/instance` → `/mnt/data/ada-sen-v2`.

The active state.json (the one with nextEventSeq 323) still has the old
scheduler MCP entry from when the session was first created — back when
sen-core's `buildMcpServers` did include it.

### Why scheduler persists

`packages/agent/src/rpc/session-config.ts:mergeMcpServers` has **union
semantics**:

```ts
for (const oldServer of existingServers) {
  const incomingServer = incomingByName.get(oldServer.name);
  if (incomingServer) merged.push({ ...incomingServer });
  else                merged.push(oldServer);   // preserves stale entries
}
```

So on session/resume:

* state.json's mcpServers (from pre-PRI-1744) = `[private-journal, knowledge,
  scheduler, scribe, slack]`
* sen-core's incoming mcpServers (post-PRI-1744) = `[private-journal,
  knowledge, scribe, slack]` (no scheduler)
* merge result = state.json entries kept ∪ incoming = **scheduler stays**

Then `reconcileMcpServersForActiveSession` spawns each entry → ERR_MODULE_NOT_FOUND.

## Why union semantics are wrong here

Two distinct populations end up in `state.config.mcpServers`:

1. **Embedder-managed** (set via session/new + session/resume `params.mcpServers`):
   sen-core declares its full set on every container restart.
2. **User-managed** (set via `ent/mcp/servers/upsert` from the TUI MCP panel):
   added interactively by an operator.

The embedder is the source of truth for population 1 — when it drops a server
from its list, that drop must propagate. The user is the source of truth for
population 2 — operator additions must survive sen-core's resume calls.

Current code conflates the two: every entry in state.json is preserved if
not in the incoming list, so embedder-deletions never take effect.

## Verified absent (and these stay absent)

* Persona files on Ada (core.md, librarian.md, browser-driver.md, shell.md,
  therapist.md, box-shell.md) — no scheduler refs
* `templates/agent-personas/core.md` in sen-core — no scheduler refs
* `mcp-config.json` (instance + state copies) — no scheduler refs
* `getCoreMcpEntries()` in sen-core — only returns slack
* sen-core's `buildMcpServers` source — no scheduler refs

The reference is **only** in the stale state.json's mcpServers and (separately
and benignly) in old `context_injected` events embedded in events.jsonl.

## Fix design

**Track ownership of each MCP server in state.json.**

* Extend the lace-internal `SessionState.config.mcpServers` entry shape with
  an optional `source: 'embedder' | 'user'` field (storage-side only — not in
  the protocol schema).
* Embedder calls (session/new, session/load, session/resume) tag every
  incoming MCP server entry as `source: 'embedder'`.
* `ent/mcp/servers/upsert` tags new/updated entries as `source: 'user'`.
* New merge semantics for session/load + session/resume
  (`applyEmbedderMcpServers`): replace **all** `embedder`-source entries with
  the incoming list. Preserve `user`-source entries.
* Existing entries without `source` are treated as `embedder` (migration).
  This means: on the next session/resume after the fix lands, Ada's stale
  scheduler entry (no source) gets purged because sen-core's incoming list
  does not contain it.
* session/new's existing persona-defaults + request-level additive merge stays
  (both inputs come from the embedder; final entries all tagged `embedder`).

## Verification plan

1. Reproduce locally: write a state.json with scheduler in mcpServers, call
   session/resume with an incoming list that omits it, observe the bug
   (scheduler kept).
2. Land fix; reproduce test now sees scheduler removed.
3. Update `session-load.rehydrate-config.test.ts` — the existing test at
   line 84-87 documents and encodes the union-merge bug. Replace with
   replace-semantics expectations.
4. Add new test covering: user-source entries survive a session/resume that
   omits them.
5. Deploy fix to Ada; remove stub; restart container; confirm boot and
   alarm tool list still works.

## Sibling hardening (not in this fix)

Even with this fix landed, an embedder bug or operator typo could still get
lace into a state where it tries to spawn a non-existent MCP command. Lace
should warn-and-skip in `reconcileMcpServersForActiveSession` on
`ERR_MODULE_NOT_FOUND` / `ENOENT` from spawn rather than letting the failure
propagate as a process crash. File this as a separate kata.
