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
- **Index projection** → discriminators + the verbatim event line. The
  discriminators (next seq, last `turn_end` seq, idempotency keys, pending
  immediate injects, turn_end dedup) answer most queries with a column lookup —
  but idempotency compares the full prompt *content* (`classifyPromptHandoff`
  does a deep-equal on the prompt body), so the index must also carry the
  verbatim event line, not just columns. **Full history, not windowed** — dedup
  and idempotency must see turnIds and content from *before* the last compaction,
  even though the conversation projection is windowed to the current era. Stored
  cross-process (SQLite/WAL).
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
So the read path keeps **one cheap check**: read the session's current max event
seq, and if it's beyond what the projection has applied, rebuild.

Getting that check actually cheap is an unsolved detail today, not a settled
property — and the spec should say so. Events are sharded across
`persona/date/` files with filesystem-dependent ordering, so "read the tail of
the newest shard" is wrong (a cross-midnight or other-persona append lands the
max seq elsewhere), and no seek-from-end reader exists yet, so today's derive is
O(events). The fix is a design decision to make explicitly, not hand-wave: a
per-session **monotonic head** (a tiny pointer holding the max seq, updated and
fsync'd with every append, read O(1)), or the lock-consistent index's `MAX(seq)`,
or de-sharding to one append log per session. Whatever we pick must be
cross-process authoritative for *assigning* the next seq (the current
disk-derive is correct precisely because it sees every process's appends; a
per-process in-memory counter or a best-effort index is not — it can hand out a
duplicate/low seq and corrupt the log). Resolve this before building Step 3/6;
it is the linchpin of cross-process safety, and it is the part most likely to be
wrong if rushed.

### Layer 3 — Context assembly (provider-neutral stable inputs, watched bytes)

The conversation projection is **provider-neutral**: it produces lace's internal
`ProviderMessage[]` prefix, which feeds every provider's converter
(`convertToAnthropicFormat`, `convertToOpenAIFormat`, `convertToGeminiFormat`,
text-only). A turn's request object is `[converted prefix] + [live tail]`. The
*neutral* prefix is stable across turns because the events that produce it are
immutable and the reducer is deterministic — and that stability is what every
provider's caching wants, even though the mechanism differs:

- **Anthropic / Bedrock**: explicit `cache_control` markers
  (`attachMessageCacheBreakpoints` places a rolling-tail + anchor each turn). The
  markers move; that's fine — the cache matches on content, not markers. Drift in
  the prefix is the worst case: an explicit ~5× re-bill of the cached tokens.
- **OpenAI**: automatic server-side prefix caching; lace places no markers. A
  stable prefix earns the automatic discount; drift just *loses* the discount —
  gentler than Anthropic, same principle.
- **Gemini / local (ollama, lmstudio)**: lace manages no explicit cache today; a
  stable prefix still helps wherever the backend reuses prefix/KV state. We do not
  assume a mechanism lace doesn't have.

So the architecture's job is the **stable neutral prefix + a deterministic
per-provider conversion**; the cache *mechanism* lives in each provider adapter.
A session that switches providers (`modelId`/`connectionId` change) keeps its
**projection** but loses its **cache**: each provider serializes a different
prefix shape (Anthropic uses a `system` field, OpenAI prepends a `system` chat
message, Gemini uses `systemInstruction`; tool schemas differ too) into a
different cache namespace, so a switch cold-starts caching. The projection
surviving is what makes the switch cheap to *assemble*; it does not preserve the
cache.

What we add is not a byte-splicer; it is:

- **A determinism invariant (below)** on the inputs (and on each converter), so
  the prefix really is stable.
- **Two golden-bytes gates, per provider** — because "byte-identical" means two
  different things and the literal body legitimately changes turn-to-turn for the
  marker providers:
  - *refactor-equivalence*: the old full-scan path and the new projection path
    produce the **same** serialized body for the same inputs — full
    `Buffer.equals`, markers and all. This is the gate that proves the refactor
    is safe.
  - *cross-turn cache-stability*: turn N and turn N+1 with an unchanged prefix
    produce the same prefix bytes **after stripping `cache_control` markers**.
    For Anthropic/Bedrock the roving anchor marker moves *inside* the prefix every
    turn (so a raw `Buffer.equals` over the literal body would fail every turn,
    falsely); the existing `cache-control-byte-stable` test already strips markers
    for exactly this reason. OpenAI has no markers, so its prefix compares whole.
    Drift here — after stripping — is the real cache regression.
- **A runtime cache-health signal** (provider-reported cache read/write per turn,
  for providers that report it) so drift in prod is visible immediately.

So byte-identity is *enforced and watched, per provider* — not *constructed by
freezing bytes*. This is the honest correction to revision 1.

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
   cheap max-seq tip-check for cross-process coherence (see Layer 2 — making it
   actually cheap is an open design item). Full scans (the O(events) re-derive)
   are for cold rebuild, the sampled canary (Invariant 6), and the test oracle —
   never per turn.
3. One reducer for events → the message prefix. The batch rebuild and the
   incremental update are the same function. The conversation projection models
   the persisted prefix only; the runner's non-persisted live-tail mutations are
   outside it.
4. Byte-identity of the cached prefix is enforced **per provider** by a golden-
   bytes test and watched by a prod cache-health signal — not asserted "by
   construction." The reducer guarantees the neutral message *array*; each
   provider's golden test guarantees *that provider's* serialized bytes. The win
   (a stable, cheaply-produced prefix) is provider-neutral; the stakes of drift
   differ (Anthropic/Bedrock ~5× re-bill; OpenAI loses an automatic discount;
   local loses KV reuse).
5. Persona, tools, skills, and system-prompt rendering — **and each provider's
   message converter** — are **byte-deterministic** (no timestamps, no
   nondeterministic ordering, stable cwd handling). This is load-bearing — every
   provider's cache rests on it — and it must be tested directly, per converter.
   One known landmine: the Gemini converter decodes a tool name from an id minted
   with `Date.now()/Math.random()`; it is deterministic *only* because that id is
   persisted verbatim in the event and never regenerated. Any path that re-mints
   it breaks the prefix. The per-converter determinism test must cover this.
6. Any derived store can be bypassed. There are **two distinct detectors**, and
   conflating them is a mistake: (a) *cross-process staleness* — the cheap max-seq
   tip-check; if the tip advanced past what the projection applied, rebuild. This
   is the frequent case (every cross-process inject) and must stay cheap. (b)
   *reducer divergence* — the rare bug where the incremental fold disagrees with
   the batch fold; caught by a **sampled canary** that does a full re-derive and
   compares, infrequently (a timer or 1-in-N turns), accepting its O(events) cost
   precisely because it is rare. Do **not** trigger the full re-derive on every
   tip-change — that reintroduces the O(events) cost on the hot path. A wrong-but-
   well-formed projection must not reach the wire silently; the canary plus the
   prod cache-health signal are what catch it where fixtures can't.
7. Seq derivation is disk-authoritative (tail-read), never a best-effort index.
8. Snapshots are written under the per-session lock, consistent with the log
   append. Crash recovery may *append* synthesized `turn_end` events
   (`repairOrphanTurnStarts`), so "snapshot == log" is defined against the
   post-recovery log — and recovery must run to completion within the cold-open
   lock *before* any snapshot is trusted or compared. This matters for the
   **index** projection (turn_end dedup/watermark change when a turn_end is
   appended); the conversation projection happens to be unaffected only because
   it has no `turn_end` case — don't rely on that coincidence for the index.
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
  (Correction to rev2: `countTokensExplicit` is **not** dead — it is live on the
  OpenAI no-usage fallback path (`openai-provider.ts` calls `_countTokensImpl`
  directly), where it independently re-serializes the wire shape. So it *is* in
  the determinism net for OpenAI-compatible providers and the per-converter
  golden test must cover it; it is unused for Anthropic. The earlier "dead code"
  claim was an Anthropic-only fact wrongly generalized — twice now; don't.)
This step is the gate every later step passes through.

**Step 1 — One reducer.** Unify the three event→message coalescers
(`message-builder.ts`, `compaction/toolkit.ts buildPreservedTail`, and the
runner's inline `tool_result` construction) into a single pure `foldEvent`. Prove
`fold-incremental == fold-batch` with a differential test and a fuzz harness.

This is **not** a zero-behavior-change refactor, and the spec was wrong to call
it one: today the runner emits *one user message per tool result* on a
parallel-tool turn, while the batch rebuild *coalesces* them into one user
message with N `tool_result` blocks — a genuinely different wire shape. Unifying
picks one canonical shape, which changes the live-tail bytes for those turns
(it's in the tail, not the cached prefix, so it doesn't bust the prefix cache —
but it *is* a wire change, gated by the refactor-equivalence golden test as a
deliberate change). Worth flagging the deeper smell this exposes: because sent
shape (N) and rebuilt shape (1) already differ today, the prefix a later turn
rebuilds may not match what was actually sent on the parallel-tool turn —
i.e. there may already be a latent cache break at those boundaries. Investigate
that while unifying.

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

- **Golden-bytes, per provider, two gates** (Step 0): for each converter,
  (a) refactor-equivalence — old path vs new path, same inputs, full
  `Buffer.equals`; and (b) cross-turn cache-stability — turn N vs N+1,
  markers stripped (Anthropic/Bedrock) or whole (OpenAI). The non-negotiable gate.
- **Render-determinism** (Step 0): system + tools + each provider's converter
  render to identical bytes regardless of wall-clock/cwd/enumeration (Invariant 5).
- **Reducer equivalence** (Step 1): incremental fold equals batch fold, fuzzed.
- **Snapshot round-trip** (Step 4): rebuild-from-snapshot equals rebuild-from-
  post-recovery-log, byte-for-byte.
- **Sampled canary** (Step 4): a *rare* full re-derive vs. the in-memory
  projection, in production, alarm on mismatch — catches a reducer bug a fixture
  can't. Rare on purpose (it's O(events)); it is **not** the cross-process
  staleness check (that's the cheap tip-check, run every turn).
- **Prod cache-health signal** (Step 0): cache read rate and per-turn read cost
  graphed; a regression shows up immediately.

## Non-goals and what stays put

- The on-disk log format does not change. Old sessions cold-build their
  projections on first load; nothing to migrate, no backward-compat shims.
- The recall FTS index is not touched. It serves search; it stays lossy/separate.
- We do **not** take over body serialization from any provider SDK (Anthropic,
  OpenAI, Gemini, …). We control the request *object* and make its prefix stable;
  each SDK still serializes and owns transport, auth, retries, and streaming.
- The log, projections, compaction, and the O(N²) fix are **provider-neutral** —
  they operate on neutral events and the neutral `ProviderMessage[]`. Only the
  converters and per-provider cache mechanisms are provider-specific, and they
  live behind the provider adapter, not in the core.

## What review changed

**Revision 2 → 3** (second adversarial round, on the rev2 changes): the recurring
fault was over-claiming, and the reviewers caught it every time. Fixed: the
"O(1) tip-check / tail of the newest shard" was wrong (events are sharded across
persona/date with filesystem-dependent order; no seek-from-end reader exists) —
now framed as an explicit open design item (a per-session monotonic head, or the
lock-consistent index max, or de-sharding). The `Buffer.equals` golden gate over
"the literal body" is unimplementable for the marker providers (the anchor marker
moves inside the prefix every turn) — split into *refactor-equivalence* (full
bytes) and *cross-turn stability* (markers stripped). `countTokensExplicit` is
**live** on the OpenAI no-usage path — the rev2 "dead code" claim was wrong
(an Anthropic-only fact generalized; the second time that bit, now logged). Step 1
is **not** a zero-wire-change refactor — unifying the three coalescers changes the
parallel-tool-turn shape (N user messages vs 1) and may expose a pre-existing
sent-vs-rebuilt cache break. The divergence guard split into a cheap per-turn
staleness tip-check vs a rare sampled reducer-bug canary (re-deriving on every
tip-change reintroduced O(events)). Plus: provider switch keeps the projection
but loses the cache; the index carries the verbatim line (idempotency deep-equals
content); recovery must finish before any snapshot compare (matters for the index);
and the Gemini converter's `Date.now()/Math.random()` tool-id is a named
determinism landmine.

**Revision 1 → 2** (first adversarial round)

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

The log is the truth and is read on the hot path only as a cheap max-seq
tip-check; everything a turn needs is a projection kept current as events append; compaction
seals the message era so per-turn rebuild cost is O(tail-since-compaction) and
resets; and byte-identity of the cached prefix is held by deterministic inputs, a
golden test, and a production cache-health guard — not by freezing bytes.
