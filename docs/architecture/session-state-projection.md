<!-- ABOUTME: How Lace derives a turn's conversation projection in O(tail) by -->
<!-- ABOUTME: holding it in memory across turns and folding only the new tail. -->

# Session-state projection (in-memory, O(tail) turn entry)

At the start of every turn the agent needs the conversation projection: the
provider message prefix, the system prompt, the files-read set, and the
last-turn-end watermark. Rather than re-parsing the whole durable event log each
turn, the agent process holds the projection **in memory across turns**, keyed
by session, and on each turn folds only the events appended since the last turn.

## The mechanism

The agent process keeps a per-session projection cache (`projectionCache` on the
server state, keyed by sessionId). A cached projection carries:

- the rebuilt provider messages (the fold state),
- the system prompt (last-wins, era-scoped),
- the files-read set,
- the last-turn-end seq (the inject watermark), and
- `headSeq` — the **next seq to fold**.

On turn entry the runner reads the O(1) `.seq` tip (the next-free seq). If a
projection is cached for the active session and the tip has not moved backward,
the runner tail-reads only the events with `eventSeq >= headSeq` and folds them
into the cached projection — O(tail) instead of O(events). Because `headSeq` is
the next seq to fold, an event already folded is never re-applied. Both
own-process and cross-process appends advance `.seq`, so the tail-read sees
every new event (including a context inject written by another process between
turns).

On a cold start, a cache miss, or a tip that moved backward, the runner falls
back to a full rebuild over the whole log and seeds the cache from it.

The incremental fold and the full rebuild apply the **same** per-event handler,
so an incremental fold is byte-identical to a full rebuild over the same events.

## The projection is the persisted prefix only

The cache holds only what is durable on disk. The runner's non-persisted
per-turn live-tail mutations — loop reminders, tool_result construction,
tool-choice retries — are layered onto the per-turn provider messages and are
never folded into the cached projection.

## Divergence canary

A sampled divergence canary (gated by `LACE_PROJECTION_CANARY`) re-derives the
full projection and compares it against the cached one. On a mismatch it logs an
error and drops the cache entry so the next turn cold-rebuilds from the log. The
canary is O(events), so it is sampled, never run every turn.

## Bounded stop reminders (draft proposal)

After a tool round-trip, a text-only response receives at most one reminder with
`toolChoice: required` when an immediate mid-turn arrival is pending, the
response is empty, or its final substantive sentence or line declares future
work and another model round remains. Completed reports can end naturally;
earlier intent, the specific negated prefix “not something I’ll / I will”, or a
standalone turn-closing declaration does not by itself require another tool
call. The wording predicate only selects the reminder. It never changes the
terminal outcome to `incomplete`.

The pending-arrival marker clears when a nonempty tool-result batch enters
provider history. An arrival admitted on a later iteration establishes a fresh
marker. Provider pauses and reminder retries preserve pending arrivals. A tool
result is progress for reminder purposes, not evidence that the arrival was
answered or a user received a reply.

This proposal has unresolved compatibility with Sen's delegate outcome contract.
A delegate that reads a file, repeatedly promises to write it, and never writes
can now return `end_turn`, which the existing job mapper reports as `completed`.
The unchanged therapist end-to-end regression rejects that outcome. Its negative
contract must be reconciled with legitimate completed work followed by
human-dependent deferral before merging this draft.

Turn and cost limits, tool-error handling, cancellation, and the mapping of an
explicit `incomplete` outcome remain in their existing owners. Neither native
`end_turn` nor a completed delegate status certifies successful work or user
delivery. This draft adds no completion classifier or settlement API.
