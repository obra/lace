# Session State Architecture

Author: architect (jesse-claude). Status: design intent, to build against.

This is the mental model and the build plan. It is not a patch list. Read it to
understand *why* the pieces exist and what must never break.

## The problem

A lace session is an append-only event log. Today every per-turn operation
rebuilds what it needs by reading and parsing the **entire** log from disk —
5-8 times per turn (message rebuild, idempotency, last-turn-end, next-seq,
inject scans), plus a full scan on **every** durable write to compute the next
event seq. Measured on a real coworker: 11k events, ~368k tokens, ~2.8s per
read, 9-18s of dead time between turns.

Two consequences make this a foundation problem, not a slow-day:

1. **It grows forever.** The read cost is O(total events ever). Compaction does
   not reduce it — the builder reads all events and then discards everything
   before the last compaction. So per-turn cost rises with session age, and a
   session's total cost is O(turns²). A months-old coworker is unusable.
2. **The cache is held together by luck.** We rely on the Anthropic prompt cache
   (a real session shows ~364k cached tokens/turn, ~5× cost saved). That only
   works because the serialized request prefix is byte-for-byte identical across
   turns — and today that identity is an *emergent accident* of several
   unenforced facts. One stray byte in a tool description re-bills 364k tokens
   every turn, silently.

## The intent

Stop reading the log on the hot path. The log is the durable write model; what a
turn needs are **derived read models** kept up to date as events are appended.
And make the cache prefix a thing we *guarantee*, not a thing we hope holds.

Concretely, the architecture is three layers plus one cross-cutting rule about
compaction.

### Layer 1 — The log (write model)

Append-only, immutable, one writer per session (the existing per-session lock).
It is the single durable source of truth. It exists for durability, audit, and
rebuilding the layers above. **It is never read in full on the hot path.** That
sentence is the whole point; everything else serves it.

### Layer 2 — Projections (read models)

Every derived view is produced by one reducer, `apply(state, event)`, folded
forward as events are appended — never rebuilt by rescanning. We have three:

- **Conversation projection** → the `ProviderMessage[]` we send the model. This
  is the keystone. There is exactly **one** implementation of "events →
  messages" (the reducer); the batch rebuild is the same reducer over the whole
  list. One implementation is what makes byte-identity provable instead of hoped.
- **Index projection** → the cheap discriminators a turn needs: next event seq,
  last `turn_end` seq, idempotency keys, pending immediate injects. O(1) lookups.
- **Recall projection** → full-text search. This already exists and stays
  separate. It is allowed to be lossy and redacted because it is *not* on the
  context path. Do not entangle it with the two above.

Each projection is: authoritative **in memory** during a live session; saved to
a durable **snapshot** so a cold start is fast; and **rebuildable from the log**
at any time. Every projection is advisory — if it ever disagrees with the log,
we throw it away and rebuild. The log is always the tiebreaker.

### Layer 3 — Context assembly (cache-first)

A turn's request is **[sealed prefix] + [small live tail]**. A "segment" — the
system prompt, the tool set, a compacted era, a finalized message — is serialized
to its canonical bytes **once, when it becomes immutable**, and never again. The
cached prefix is then literally the same bytes turn after turn, because the
segment blobs are immutable. We own the body-serialization boundary (we use the
SDK's transport but decide the exact bytes), so there is no second serializer to
drift. Byte-identity becomes structural: the only mutable thing in a request is
the tail.

### The cross-cutting rule — compaction seals a prefix

Compaction is a state transition, not just a summarizer. It takes the history so
far, seals it into one immutable pre-serialized prefix segment, and resets the
live tail to near-empty. After compaction: the hot path is O(tail), recovery is
O(snapshot + tail), and the cache prefix is one sealed blob plus a few live
messages. This is the property that makes the system foundational: **per-turn
cost is bounded by compaction cadence, not by session age.** A three-week-old
coworker costs the same per turn as a fresh one.

## Invariants (these must always hold)

1. The log is the only durable truth. Projections, snapshots, and indexes are
   derived and rebuildable.
2. Nothing reads the full log on the hot path. Full scans exist only for cold
   rebuild and as the test oracle.
3. There is one reducer for events → messages. The batch rebuild and the
   incremental update are the same function.
4. Byte-identity of the cached request prefix is structural and gated by a test.
   A change that moves cached bytes is a loud failure, not a silent cost.
5. Any derived store can be bypassed. On divergence or corruption, fall back to a
   full rebuild from the log. No derived store is ever load-bearing for
   correctness.
6. Multi-process is first-class: the log is the cross-process truth, the index is
   the cross-process queryable projection, in-memory state is per-process.

## Build order

Build the safety net before touching a byte. Each step is independently correct,
shippable, and measured before the next. Do not skip and do not reorder.

**Step 0 — Guardrail and instrumentation.** Before any change:
- The **golden-bytes test**: capture the literal HTTP request body (after
  surrogate-sanitization and the SDK serializer) for a corpus of real fixtures —
  thinking blocks, tool calls with multi-key/numeric arguments, images, a
  compaction era with `preserved`, a post-compaction persona re-render, unicode,
  an orphaned tool block. Compare with `Buffer.equals`, not deep-equal. Pin
  `countTokensExplicit` too — it independently re-serializes the wire shape.
- **Prod cache instrumentation**: log actual cache read/write and per-turn read
  cost per turn on Ada. From here on we measure, not guess.
This step is the gate every later step passes through.

**Step 1 — One reducer.** Extract message-building into a single pure
`foldEvent`. The existing full rebuild becomes "fold over all events." Prove
`fold-incremental == fold-batch` with a differential test and a fuzz harness.
Zero behavior change; fully covered by Step 0.

**Step 2 — Buy time (surgical).** Not the architecture — the thing that makes Ada
usable in days so we can build the rest without firefighting. Tail-read for the
per-write seq derive (the single biggest cost — the max seq is the last line of
the newest file). Parse the log once instead of twice. Read the log once at the
runner's append-free entry region instead of three times. Stop `loadSession`
re-deriving and rewriting state on every mid-turn refresh. Zero byte risk.
Measure.

**Step 3 — Index projection.** A durable `event_journal`: one row per event with
the discriminator columns **and the verbatim JSONL line**. Watermark, idempotency,
and inject queries become indexed lookups. Byte-safe by construction — we replay
the stored line, never reconstruct a message from columns. Rebuildable from the
log; corruption falls back to full scan. This is also what makes a non-lossy
index real (separate from the recall FTS table, which is untouched).

**Step 4 — Conversation projection + snapshots.** Hold the `ProviderMessage[]` in
memory, maintained by `foldEvent`, checkpointed to a durable snapshot at each
compaction and periodically, rebuilt from snapshot + tail on cold start. The live
hot path is now O(tail). Guard with the golden gate, a snapshot round-trip test,
and a dev/CI invariant check that re-derives from the log and asserts equality.

**Step 5 — Sealed-prefix cache model.** The deepest change, last because the
earlier steps de-risk it. Compaction seals an immutable, pre-serialized prefix
segment; context assembly concatenates sealed bytes + live tail; byte-identity is
now an invariant the golden test merely confirms. Caching stops being something
we protect and becomes something we guarantee.

**Step 6 — Delete the old hot path.** Full-scan rebuild survives only as the test
oracle and the recovery primitive. No per-turn path scans the log.

## How we know it's right (the test contract)

- **Golden-bytes** (Step 0): the request body is byte-identical across the
  refactor and across turns for an unchanged prefix. The non-negotiable gate.
- **Reducer equivalence** (Step 1): incremental fold equals batch fold, fuzzed.
- **Snapshot round-trip** (Step 4): rebuild-from-snapshot equals rebuild-from-log,
  byte-for-byte.
- **Invariant check** (Step 4+): a dev/CI mode that re-derives every projection
  from the log and asserts equality with the live in-memory state. A divergence
  is an alarm, caught in CI or on a canary, never by a coworker that quietly got
  slow.
- **Prod cache metric** (Step 0): cache hit rate and per-turn read cost are
  graphed; a regression shows up immediately, not three weeks later.

## Non-goals and what stays put

- The on-disk log format does not change. Old sessions just cold-build their
  projections on first load; nothing to migrate, no backward-compat shims.
- The recall FTS index is not touched. It serves search; it stays lossy and
  separate.
- We do not reimplement the Anthropic SDK. We control the request **body bytes**;
  the SDK still owns transport, auth, retries, and streaming.

## The one-line summary

The log is the truth and is never read on the hot path; everything a turn needs
is a projection kept current as events append; compaction seals an immutable
cached prefix so per-turn cost is flat over a session's life; and byte-identity of
that prefix is guaranteed by construction and proven by one test.
