# Session State Architecture

Author: architect (jesse-claude). Status: design intent, to build against.
Revision 2 — corrected after adversarial review (see "What review changed").

This is the mental model and the build plan. It is not a patch list. Read it to
understand *why* the pieces exist and what must never break.

## The problem

A lace session is an append-only event log. Today every per-turn operation
rebuilds what it needs by reading and parsing the **entire** log from disk —
5-8 times per turn (message rebuild, idempotency, last-turn-end, next-seq,
inject scans), plus a full scan on **every** durable write to compute the next
event seq (`event-log.ts` `deriveNextEventSeqAcrossSessionFiles`). Measured on a
real coworker: 11k events, ~368k tokens, ~2.8s per read, 9-18s of dead time
between turns.

Two consequences make this a foundation problem, not a slow-day:

1. **It grows forever.** The read cost is O(total events ever). Compaction does
   not reduce it — the builder reads all events and then discards everything
   before the last compaction. So per-turn cost rises with session age, and a
   session's total cost is O(turns²). A months-old coworker becomes unusable.
2. **The cache is held together by luck.** We rely on the Anthropic prompt cache
   (a real session shows ~364k cached tokens/turn, ~5× cost saved). That works
   only because the serialized request prefix is byte-for-byte identical across
   turns — and today that identity is an *emergent property* of several
   unenforced facts. One stray byte in a tool description re-bills 364k tokens
   every turn, silently, with nothing watching.

## The intent

Stop reading the log on the hot path. The log is the durable write model; what a
turn needs are **derived read models** kept current as events are appended. And
make the byte-identity of the cached prefix a thing we *enforce and watch*,
rather than a thing we hope holds.

Be precise about what byte-identity is and isn't, because a reviewer rightly
caught me overstating it: the Anthropic SDK serializes the whole request object
with `JSON.stringify`. We do **not** own the serializer and we are **not** going
to freeze wire bytes and splice them. Byte-identity is therefore
`JSON.stringify(stableObject) === JSON.stringify(stableObject)`. Our job is to
make that object's prefix *provably stable and cheap to produce*, and to put a
test and a runtime guard on the bytes. The win is killing the O(events) work, not
inventing a byte-splicer.

The architecture is three layers plus one rule about compaction.

### Layer 1 — The log (write model)

Append-only, immutable, one writer per session (the per-session lock). The single
durable source of truth. It exists for durability, audit, and rebuilding the
layers above. **It is never read in full on the hot path.** That sentence is the
point; everything else serves it. (One narrow, deliberate exception survives —
see the cross-process tip-check in Layer 2.)

### Layer 2 — Projections (read models)

Every derived view is produced by one reducer, `apply(state, event)`, folded
forward as events are appended — never rebuilt by rescanning. We have three:

- **Conversation projection** → the `ProviderMessage[]` *prefix* derived from the
  persisted events. This is the keystone. Two things matter:
  - **It is the persisted prefix, not the sent array.** Per turn the runner adds
    live-tail content that is *never persisted* (loop reminders, tool-choice
    retry placeholders, pause_turn merges). Those are applied on top, per turn,
    and live only at the tail — never in the cached prefix, never in the
    projection, never in a snapshot. The projection models exactly what the log
    can reproduce.
  - **There must be exactly one reducer.** Today there are *three* event→message
    coalescers (`message-builder.ts`, `compaction/toolkit.ts buildPreservedTail`,
    and the runner's inline `tool_result` construction). Step 1 *unifies* them.
    Until they're unified, "the batch rebuild and the incremental update are the
    same function" is not yet true — that's work, not a given.
- **Index projection** → the cheap discriminators a turn needs: next event seq,
  last `turn_end` seq, idempotency keys, pending immediate injects, turn_end
  dedup. **Full history, not windowed** — dedup and idempotency must see turnIds
  and keys from *before* the last compaction, even though the conversation
  projection is windowed to the current era. Stored cross-process (SQLite/WAL),
  so it is also the coherence point between processes.
- **Recall projection** → full-text search. Already exists; stays separate;
  allowed to be lossy/redacted because it is not on the context path.

Each projection is authoritative **in memory** during a live session for the
process that holds the lock; saved to a durable **snapshot**; and **rebuildable
from the log**. Every projection is advisory — on divergence it is thrown away
and rebuilt. But "advisory" only helps if divergence is *detected*; see the two
detectors below, because a wrong-but-well-formed projection is the dangerous case.

**Cross-process coherence.** The in-memory projection is valid only while this
process both holds the lock *and* the log tip hasn't advanced under it. Subagents
and peers append to the same log from other processes (injects are a live path).
So the read path keeps **one O(1) check**: read the last event seq (the tail of
the newest shard, or the index's max), and if it's beyond what the projection has
applied, rebuild. This is the deliberate exception to "never read the log on the
hot path" — it's O(1), not O(events), and it's what makes Step 6 safe. The seq
*authority* stays the disk tail-read, never a best-effort index (a missing index
row returns a plausible-but-low number that "bypass on corruption" can't catch).

### Layer 3 — Context assembly (stable inputs, watched bytes)

A turn's request object is `[prefix from the conversation projection] + [live
tail]`. The prefix is stable across turns because the events that produce it are
immutable and the reducer is deterministic; the system prompt and tool set are
*separate* stable segments (their own cache breakpoints), not part of the message
prefix. We let the existing path serialize the object (the SDK's `JSON.stringify`)
and let `attachMessageCacheBreakpoints` place the rolling-tail and anchor markers
each turn as it does today — the markers move; that's fine, the cache matches on
content, not markers. What we add is not a byte-splicer; it is:

- **A determinism invariant (below) on the inputs**, so the stable object really
  is stable.
- **A golden-bytes test** that captures the literal serialized body and fails on
  any prefix drift.
- **A runtime cache-health signal** (cache read/write per turn) so drift in prod
  is visible immediately.

So byte-identity is *enforced and watched*, not *constructed by freezing bytes*.
This is the honest correction to revision 1.

### The rule — compaction seals the message era

Compaction is a state transition, not just a summarizer. It seals the message
history so far into the conversation projection's immutable prefix and resets the
live tail to near-empty. After compaction the conversation projection is built
from `[sealed era] + [small tail]`, so the per-turn *rebuild* work is
O(tail-since-compaction), not O(events-ever). Be precise about the win:

- Per-turn cost is **O(tail-since-compaction)**, reset at each compaction — not
  "flat." The tail grows between compactions; compaction is what bounds it. The
  asymptotic improvement over today's O(events-ever) is the real, large win.
- Compaction must run `dropOrphanedToolBlocks` (the orphan-pair guard that has
  bricked Ada before) and freeze the *post-pass* result; the reducer/pass must be
  deterministic and order-independent so the sealed era's bytes are stable.
- A post-compaction persona re-render appends a fresh `system_prompt_set` only if
  the rendered prompt actually changed (the skip-if-unchanged guard). The system
  segment is therefore stable across compactions *as long as rendering is
  deterministic* — which is why the determinism invariant below is load-bearing.

## Invariants (these must always hold)

1. The log is the only durable truth. Projections, snapshots, and indexes are
   derived and rebuildable.
2. Nothing reads the full log on the hot path. The only per-turn log touch is the
   O(1) tip-check for cross-process coherence. Full scans exist for cold rebuild
   and as the test oracle.
3. One reducer for events → the message prefix. The batch rebuild and the
   incremental update are the same function. The conversation projection models
   the persisted prefix only; the runner's non-persisted live-tail mutations are
   outside it.
4. Byte-identity of the cached prefix is enforced by a golden-bytes test and
   watched by a prod cache-health signal — not asserted "by construction." The
   reducer guarantees the message *array*; the test guarantees the *bytes*.
5. Persona, tools, skills, and system-prompt rendering are **byte-deterministic**
   (no timestamps, no nondeterministic ordering, stable cwd handling). This is
   load-bearing — the whole cache rests on it — and it must be tested directly.
6. Any derived store can be bypassed. Divergence must be *detected* (the tip-check
   and a prod divergence guard, not only a dev/CI check), then fall back to a full
   rebuild. No derived store is ever load-bearing for correctness, and a
   wrong-but-well-formed projection must not reach the wire silently.
7. Seq derivation is disk-authoritative (tail-read), never a best-effort index.
8. Snapshots are written under the per-session lock, consistent with the log
   append. Crash recovery may *append* synthesized `turn_end` events, so
   "snapshot == log" is defined against the post-recovery log.
9. Multi-process is first-class: the log is the cross-process truth, the index
   (full-history, WAL) is the cross-process queryable projection and coherence
   point, in-memory state is per-process and validated by the tip-check.

## Build order

Build the safety net before touching a byte. Each step is independently correct,
shippable, and measured before the next. Do not skip and do not reorder.

**Step 0 — Guardrail and instrumentation.** Before any change:
- The **golden-bytes test**: capture the literal HTTP request body (after
  `sanitizeLoneSurrogates` and the SDK serializer) for a corpus of real fixtures
  — thinking blocks, tool calls with multi-key/numeric arguments, images, a
  compaction era with `preserved`, a post-compaction persona re-render, unicode,
  an orphaned tool block. Compare with `Buffer.equals`.
- A **render-determinism test**: render the system prompt + tools twice (varying
  wall-clock, cwd echo, skill enumeration) and assert byte-equality (Invariant 5).
- **Prod cache-health signal**: log actual cache read/write tokens per turn on
  Ada, so a prefix regression is visible immediately instead of three weeks later.
  (Do *not* bother pinning `countTokensExplicit` — it has no production caller;
  the compaction-pressure path uses real Anthropic usage numbers.)
This step is the gate every later step passes through.

**Step 1 — One reducer.** Unify the three event→message coalescers into a single
pure `foldEvent` over the persisted events. Prove `fold-incremental ==
fold-batch` with a differential test and a fuzz harness; expect it to surface
real shape differences (e.g. one coalesced user message vs. N) that the
unification must resolve. Zero behavior change on the wire; fully covered by
Step 0.

**Step 2 — Buy time (surgical).** Not the architecture — the thing that makes Ada
usable in days. Replace the per-write full-scan seq derive with a tail-read (the
max seq is the last line of the newest shard). Parse the log once instead of
twice. Coalesce the runner-entry reads into one. Stop `loadSession` re-deriving
and rewriting state on every mid-turn refresh. Honest caveat a reviewer caught:
the runner-entry reads are append-free *with respect to this process*, but another
process can append a `context_injected` during the turn — so keep the mid-loop
inject re-read (or fold it into the tip-check). Zero byte risk. Measure.

**Step 3 — Index projection (full-history, durable, cross-process).** One row per
event with discriminator columns **and the verbatim JSONL line**, written under
the same per-session lock as the JSONL append (not best-effort, since dedup and
the tip-check depend on it). Watermark, idempotency, dedup, and inject queries
become indexed lookups over full history. Replaying the stored line feeds the
*same reducer* the same input as a JSONL read — so the message output is
identical because the reducer is identical, not because storage is "byte-safe" on
its own. Rebuildable from the log; the seq authority stays the disk tail-read.

**Step 4 — Conversation projection + snapshots.** Hold the persisted-prefix
`ProviderMessage[]` in memory, maintained by `foldEvent`, checkpointed to a
durable snapshot under the lock at each compaction and periodically, rebuilt from
snapshot + tail on cold start. The live hot path becomes O(tail). Guard with the
golden test, a snapshot round-trip test (rebuild-from-snapshot == rebuild-from-
post-recovery-log, byte-for-byte), and a **prod divergence guard**: cheaply (on a
tip-change, or sampled) re-derive and compare to the in-memory projection; on
mismatch, alarm and rebuild. The invariant check is not dev/CI-only — a real
session's state never appears in fixtures, so the guard must run where the
divergence actually happens.

**Step 5 — Delete the old hot path.** Full-scan rebuild survives only as the test
oracle and the recovery primitive. No per-turn path scans the log (the O(1)
tip-check stays).

(Revision 1 had a sixth step — "seal pre-serialized prefix bytes." It's removed:
the SDK owns serialization and the cache markers move every turn, so freezing and
splicing wire bytes isn't buildable without reimplementing the SDK body
serializer. Byte stability comes from stable inputs + the gate, per Layer 3.)

## How we know it's right (the test contract)

- **Golden-bytes** (Step 0): the request body is byte-identical across the
  refactor and across turns for an unchanged prefix. The non-negotiable gate.
- **Render-determinism** (Step 0): system + tools render to identical bytes
  regardless of wall-clock/cwd/enumeration (Invariant 5).
- **Reducer equivalence** (Step 1): incremental fold equals batch fold, fuzzed.
- **Snapshot round-trip** (Step 4): rebuild-from-snapshot equals rebuild-from-
  post-recovery-log, byte-for-byte.
- **Prod divergence guard** (Step 4): re-derive vs. in-memory on tip-change or a
  sample, in production, alarm on mismatch. Catches the divergence a fixture
  can't.
- **Prod cache-health signal** (Step 0): cache read rate and per-turn read cost
  graphed; a regression shows up immediately.

## Non-goals and what stays put

- The on-disk log format does not change. Old sessions cold-build their
  projections on first load; nothing to migrate, no backward-compat shims.
- The recall FTS index is not touched. It serves search; it stays lossy/separate.
- We do **not** take over body serialization from the Anthropic SDK. We control
  the request *object* and make its prefix stable; the SDK still serializes and
  owns transport, auth, retries, and streaming.

## What review changed (revision 1 → 2)

Two competing adversarial reviews found, and the code confirmed: (1) the old
Step 5 "seal pre-serialized prefix bytes + concatenate" is unbuildable against an
SDK-owned `JSON.stringify` with cache markers that move every turn — removed;
byte-identity is now "stable inputs + golden gate + prod signal." (2) The
conversation projection is the *persisted prefix*, not the sent array — the
runner's non-persisted live-tail mutations are explicitly outside it. (3) Added a
*production* divergence guard and an O(1) cross-process tip-check, because the
old dev/CI-only invariant check couldn't catch a wrong-but-well-formed prefix or
a stale-after-cross-process-append projection. (4) Precision fixes: O(tail-since-
compaction) not "flat"; system/tools are separate stable segments; seq stays
disk-authoritative; the index is full-history for discriminators; render
determinism is now an explicit, tested invariant; Step 1 *unifies* three
coalescers; and `countTokensExplicit` is dead code, dropped from the threat model.

## The one-line summary

The log is the truth and is read on the hot path only as an O(1) tip-check;
everything a turn needs is a projection kept current as events append; compaction
seals the message era so per-turn rebuild cost is O(tail-since-compaction) and
resets; and byte-identity of the cached prefix is held by deterministic inputs, a
golden test, and a production cache-health guard — not by freezing bytes.
