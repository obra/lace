# Session-State Step 4 — In-Memory Conversation Projection (O(tail) turn entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop re-parsing the whole event log at every turn entry. Hold the rebuilt
conversation projection (the `FoldState` + system prompt + files-read + last-turn-end
watermark) **in memory across turns**, and on each turn fold only the **new tail**
(events appended since the cached head) into it — O(tail) instead of O(events).

**Architecture:** A per-session projection cache in `AgentServerState` (same pattern as
`toolExecutorCache`). On turn entry, read the O(1) `.seq` tip (`readHead`): if a cached
projection exists for this session, tail-read the events with `eventSeq` ≥ the cached
head and fold them into the cached `FoldState` via `foldEvent` (incremental==batch is
already proven), update the derived fields + head, and reuse. On a cache miss (process
start, session switch, or a detected inconsistency) fall back to the existing full
`loadTurnEntryProjection`. A sampled production **divergence canary** re-derives the full
projection and compares; on mismatch it alarms and rebuilds. **No wire-byte change** —
the projection feeds the same converters; the Step-0 golden + sent-vs-rebuilt gates and a
new incremental==full differential test are the proof.

**Tech Stack:** TypeScript, vitest. Real files in tests.

**Why safe:** the cached projection is the **persisted prefix only** (the runner's
non-persisted live-tail mutations stay out of it, exactly as today). The incremental fold
uses the SAME `foldEvent` reducer as the full rebuild, so by `foldEvents` determinism the
result is byte-identical to a full rebuild over the same events — provable with a
differential test. The tip-check + tail-read from the cached head captures every append
(own-process and cross-process injects, since both advance `.seq`). Durable snapshots
(cold-start speedup) are intentionally **out of scope** for this step to keep the change
contained.

---

## Background (verified facts — confirm against source)

- Turn entry: `loadTurnEntryProjection(sessionDir, cwd): TurnEntryProjection`
  (`message-building/turn-entry-projection.ts:19`) = `readParsedSessionEvents` (one full
  parse) + 3 pure derivers. Called at `runner.ts:~404`; `messages → providerMessages`,
  `systemPrompt → frozenSystemPrompt`, `lastTurnEndSeq → lastSeenEventSeq`.
- Process model: ONE long-lived agent process per coworker; `AgentServerState`
  (`server.ts:113`, type `server-types.ts:124`) holds `activeSession`, `activeTurn`,
  `toolExecutorCache: Map<string, Promise<...>>` (the cache pattern to mirror), across
  turns + session switches.
- The reducer: `foldEvent(state, event)` / `foldEvents(events)` /
  `initialFoldState()` (`message-building/fold-event.ts`) — `FoldState = { messages,
  batch }`. `buildProviderMessagesFromParsedEvents` (`message-builder.ts`) folds parsed
  events through it PLUS the rebuild-only concerns (system-prompt extraction, the
  `context_compacted` reset to `preserved[]` + `dropOrphanedToolBlocks`, the
  `context_injected` text-merge via `appendOrMergeUser`, empty-prompt drop). **The
  incremental path must apply those same rebuild-only concerns** — so it is cleanest to
  fold via a function that mirrors `buildProviderMessagesFromParsedEvents`'s per-event
  handling, not raw `foldEvent` alone.
- `.seq` tip: `readHead(sessionDir): number | undefined` (`seq-head.ts:27`) = the
  next-free seq (advanced under the flock on every append). O(1) `readFileSync`. The
  latest written seq is `readHead() - 1`.
- Tail read by seq: `readDurableEvents(sessionDir, { afterEventSeq, ... })` exists, but it
  full-scans; the inject tailer (`storage/inject-tailer.ts`, Step 3.2) already does a
  byte-offset tail read — reuse its `readNewCompleteLines` primitive or
  `readParsedSessionEvents` filtered by seq. For correctness-first simplicity, the
  incremental fold MAY read events with `eventSeq >= cachedHead` via a parsed read filtered
  by seq; optimize to a byte-offset tail later if needed.
- `ParsedSessionEvent = { eventSeq, type, data }` (`message-building/parsed-events.ts`).

**Test command:** `cd packages/agent && npx vitest run <path>`.

---

## File Structure

**Create:**
- `packages/agent/src/message-building/incremental-projection.ts` — the cached projection
  type + `foldTailIntoProjection` (apply the rebuild-only-aware per-event handling for a
  tail of events to a cached state) + `projectTurnEntry(sessionDir, cwd, cache)` (the
  cache-aware turn-entry entry point: tip-check → incremental fold or full rebuild).
- `packages/agent/src/message-building/__tests__/incremental-projection.test.ts`

**Modify:**
- `packages/agent/src/server-types.ts` + `server.ts` — add `projectionCache:
  Map<string, CachedProjection>` to `AgentServerState` + `createAgentServerState`.
- `packages/agent/src/core/conversation/runner.ts` — turn entry calls
  `projectTurnEntry(...)` with the process projection cache instead of
  `loadTurnEntryProjection` directly (cold path still uses it).
- The runner must have access to the cache — confirm how the runner reaches
  `AgentServerState` (it is constructed with deps; thread the cache in as a dep, or pass a
  `getProjectionCache()` accessor).

---

## Task 1: `foldTailIntoProjection` + the cached-projection type (pure, the heart)

**Files:** `incremental-projection.ts`, test

- [ ] **Step 1: The differential test FIRST (incremental == full rebuild).** This is the
  correctness gate. For a corpus of event sequences (plain, tool, parallel-tool, thinking,
  context_injected merge, a compaction era, post-compaction tail), assert that folding the
  events in TWO halves incrementally equals folding them all at once via the full builder:

```ts
import { describe, it, expect } from 'vitest';
import { readParsedSessionEvents } from '@lace/agent/message-building/parsed-events';
import { buildProviderMessagesFromParsedEvents } from '@lace/agent/message-building/message-builder';
import { initialCachedProjection, foldTailIntoProjection } from '@lace/agent/message-building/incremental-projection';

function fullVsIncremental(events) {
  const full = buildProviderMessagesFromParsedEvents(events);
  // incremental: fold first K, then the rest
  for (let k = 0; k <= events.length; k++) {
    let proj = initialCachedProjection();
    proj = foldTailIntoProjection(proj, events.slice(0, k));
    proj = foldTailIntoProjection(proj, events.slice(k));
    expect(JSON.stringify({ messages: proj.messages, systemPrompt: proj.systemPrompt }))
      .toBe(JSON.stringify({ messages: full.messages, systemPrompt: full.systemPrompt }));
  }
}

it('incremental fold (any split) equals full rebuild — across the corpus', () => {
  for (const events of CORPUS) fullVsIncremental(events);
});
```

> Build `CORPUS` as arrays of `ParsedSessionEvent` covering: prompt/message/tool_use,
> a parallel-tool turn, a thinking turn, a `system_prompt_set` then a later one
> (last-wins), a `context_injected` (merge), and a `context_compacted` with `preserved`
> followed by tail events. The split-at-every-K is what proves order-independence of the
> incremental boundary. This is the same property Step 1's fuzz proved for `foldEvent`;
> here it must hold for the FULL rebuild semantics (incl. system-prompt + compaction +
> inject-merge), so `foldTailIntoProjection` must mirror
> `buildProviderMessagesFromParsedEvents` exactly.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement.** `CachedProjection = { foldState: FoldState; systemPrompt:
  string; systemPromptCount: number; filesRead: Set<string>; lastTurnEndSeq: number |
  null; headSeq: number }`. `foldTailIntoProjection(proj, events)` walks `events` applying
  EXACTLY the per-event handling of `buildProviderMessagesFromParsedEvents` (system-prompt
  last-wins + count-reset on compaction; `context_compacted` resets the foldState to
  `preserved[]` + `dropOrphanedToolBlocks`; `context_injected` text-merge;
  `prompt`/`message`/`tool_use` via `foldEvent`; track `filesRead` and `lastTurnEndSeq`),
  advancing `headSeq` to the max seq seen. **Refactor `buildProviderMessagesFromParsed
  Events` to share this per-event handler** (DRY — one place handles an event, used by both
  the full builder and the incremental fold) so they cannot diverge. Expose `messages`/
  `systemPrompt` getters on `CachedProjection`.

> The DRY refactor is the safety mechanism: if the full builder and the incremental fold
> share the exact same per-event function, incremental==full holds by construction. Do
> this refactor; do not maintain two parallel event-handling switch statements.

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/message-building/incremental-projection.ts packages/agent/src/message-building/__tests__/incremental-projection.test.ts packages/agent/src/message-building/message-builder.ts
git commit -m "feat(session-state): foldTailIntoProjection — incremental projection sharing the rebuild event-handler (incremental==full)"
```

---

## Task 2: `projectTurnEntry` — cache-aware turn entry with the `.seq` tip-check

**Files:** `incremental-projection.ts`, test

- [ ] **Step 1: Failing test** — first call builds (full); a second call after appending
  tail events folds incrementally (asserts equality with a fresh full rebuild AND that the
  full parse was NOT re-run — spy on `readParsedSessionEvents`); a cross-process inject
  appended between calls is picked up; `headSeq` advances:

```ts
it('reuses + tail-folds across calls; matches full rebuild; cold-builds once', () => {
  const cache = new Map();
  // write initial events; first call → full build
  const p1 = projectTurnEntry(sessionDir, cwd, cache);
  // append more events (a turn's worth + an inject)
  const spy = vi.spyOn(parsedEvents, 'readParsedSessionEvents');
  const p2 = projectTurnEntry(sessionDir, cwd, cache);
  expect(spy).not.toHaveBeenCalled(); // O(tail) path: no full re-parse
  // equals a fresh full rebuild over the whole log
  expect(JSON.stringify(p2.messages)).toBe(
    JSON.stringify(loadTurnEntryProjection(sessionDir, cwd).messages)
  );
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement `projectTurnEntry(sessionDir, cwd, cache)`:**
  - `tip = readHead(sessionDir)`. (If undefined — no `.seq` yet — fall back to full build.)
  - `cached = cache.get(sessionId)`.
  - If `cached` and `cached.headSeq <= tip`: tail-read events with `eventSeq >=
    cached.headSeq` (a seq-filtered parsed read; reuse `readParsedSessionEvents` filtered,
    OR the byte-offset tailer for O(tail) — pick the simplest correct first, optimize
    later), `foldTailIntoProjection(cached, tailEvents)`, store, and return
    `{ messages, systemPrompt, filesRead, lastTurnEndSeq }`.
  - Else (cold / no cache / tip moved backward somehow): full `loadTurnEntryProjection`,
    seed a `CachedProjection` from it (build the FoldState from the full parse), store,
    return.
  - **Invalidate on session switch:** the cache is keyed by sessionId, so a different
    active session simply uses a different entry — no explicit clear needed; confirm a
    `session/fork` or `session/load` that changes the on-disk log under the same sessionId
    can't serve a stale cache (the tip-check + seq-filtered tail-read handles appends; a
    full REPLACEMENT of the log — fork copies into a NEW sessionId, so not an issue).

> CRITICAL correctness note: if the tail-read uses `eventSeq >= cached.headSeq` and
> `cached.headSeq` is the next-free seq cached last turn, then events with seq ==
> cached.headSeq onward are the new ones; do not double-apply an event already folded.
> Define headSeq precisely as "next seq to fold" and tail-read `> lastFoldedSeq`. Add a
> test that re-calling with NO new events is a no-op (folds nothing, returns the same).

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/message-building/incremental-projection.ts packages/agent/src/message-building/__tests__/incremental-projection.test.ts
git commit -m "feat(session-state): projectTurnEntry — O(tail) cache-aware turn entry via the .seq tip"
```

---

## Task 3: Wire into `AgentServerState` + the runner + the divergence canary

**Files:** `server-types.ts`, `server.ts`, `runner.ts`, test

- [ ] **Step 1: Add the cache.** `projectionCache: Map<string, CachedProjection>` in
  `AgentServerState` (server-types.ts) + `createAgentServerState` (server.ts). Thread it to
  the runner (the runner already receives deps; add the cache or a getter).

- [ ] **Step 2: Runner turn entry** calls `projectTurnEntry(sessionDir, cwd,
  projectionCache)` instead of `loadTurnEntryProjection`. Preserve every downstream
  variable (`providerMessages`, `frozenSystemPrompt`, `filesRead`, `lastSeenEventSeq`) +
  the `if (!frozenSystemPrompt) throw` guard.

- [ ] **Step 3: Divergence canary (prod safety).** Add a sampled check (e.g. 1-in-N turns
  or behind a `LACE_PROJECTION_CANARY` env): after `projectTurnEntry`, also run the full
  `loadTurnEntryProjection` and compare `JSON.stringify(messages)`; on mismatch,
  `logger.error('projection divergence', {...})` AND drop the cache entry (force a rebuild
  next turn). This catches a cache bug a fixture can't. It is O(events) so it must be
  SAMPLED, never every turn.

> The canary is the production net for the one thing tests can't fully cover (a real
> session's state). Default the sample rate low (or env-gated, default off) but make it
> trivial to turn on for the Ada validation pass.

- [ ] **Step 4: Verify — the byte gates are untouched + the runner suite green.**

Run: `cd packages/agent && npx vitest run src/message-building src/core/conversation src/providers/__tests__/golden && npm run typecheck && npm run lint` (repo root for the latter two)
Expected: PASS; goldens + sent-vs-rebuilt unchanged (the projection feeds the same converters; the messages are identical to the full rebuild by Task 1's equivalence).

- [ ] **Step 5: Commit + evergreen doc.**

Add to `docs/architecture/` (present-tense, no refs): turn entry holds the conversation
projection in memory keyed by session; each turn folds only the events appended since the
cached `.seq` head (O(tail)); a cold start or a sampled divergence canary falls back to a
full rebuild; the projection is the persisted prefix only (the runner's per-turn live tail
stays out of it).

```bash
git add packages/agent/src/server-types.ts packages/agent/src/server.ts packages/agent/src/core/conversation/runner.ts docs/architecture/session-state-projection.md
git commit -m "feat(session-state): in-memory projection cache + divergence canary (O(tail) turn entry)"
```

---

## Self-review notes (for the executor)

- **Correctness gate = incremental==full** (Task 1), achieved by the DRY refactor (one
  shared per-event handler used by both the full builder and the incremental fold). If you
  find yourself writing a second event-handling switch, STOP and share the first.
- **The cached projection is the PERSISTED PREFIX ONLY.** The runner's non-persisted
  live-tail mutations (loop reminders, tool_result construction, tool-choice retries) are
  NOT cached — they live only in the per-turn `providerMessages`, exactly as today.
- **The `.seq` tip is the coherence point** — tail-read from `lastFoldedSeq`; both
  own-process and cross-process appends advance `.seq`, so the tail-read sees them.
- **No wire-byte change.** The Step-0 golden + sent-vs-rebuilt gates must stay green with
  zero golden changes.
- **Out of scope:** durable projection snapshots (cold-start speedup) and Step 5 (deleting
  the old full-scan path — that comes after this is validated).
- **Deploy behind the canary** (env-gated, on for the Ada validation pass) — do not trust
  the cache on a live coworker until the canary has run clean for a while.
