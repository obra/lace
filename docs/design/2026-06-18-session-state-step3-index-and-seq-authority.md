# Session-State Step 3 — Durable Index + Cross-Process Seq Authority (design)

Status: design intent, to be adversarially reviewed before building. This is the
linchpin the architecture spec flagged as "the part most likely to be wrong if
rushed." It changes how event sequence numbers are assigned, so a mistake corrupts
the durable log. Read the crash/concurrency analysis as the load-bearing section.

## The problem

Every turn pays for full-log scans (measured: the dominant per-turn cost):
- `deriveNextEventSeqAcrossSessionFiles` — a full scan **on every append** (5-8/turn)
  to compute the next `eventSeq`. Runs **outside any cross-process lock** (the only
  lock is the runner's in-process `runExclusive` mutex), so two processes that append
  to the same session concurrently (the inject path is cross-process and live) can
  both derive the same seq and write a duplicate — a latent log-corruption race.
- `findLastTurnEndEventSeq`, `findTurnEndEventByTurnId`, `classifyPromptHandoff`
  (idempotency), `readImmediateInjectsSince` — each a full-log scan, several per turn.

lace already keeps a per-instance SQLite database (`<laceDir>/recall/index.sqlite`,
better-sqlite3, WAL) and write-throughs every event into an FTS5 table on append, with
a startup backfill that repairs anything missed. But that index is **lossy** (FTS only:
5 event types, rendered/sanitized content, no `turnId`/`turnSeq`, no verbatim line), so
it cannot answer the hot-path queries or feed the message reducer.

## The decision

**The cross-process seq authority is a per-session counter row in SQLite, advanced and
committed in its own short `BEGIN IMMEDIATE` transaction *before* the JSONL append. The
durable JSONL log stays the source of truth. Sequence numbers are unique and
monotonic but **may have gaps**.**

And: **add a non-lossy `event_journal` table** (one row per event: discriminator
columns + the verbatim JSONL line) as the durable, cross-process, full-history read
model. The five hot-path scans become indexed lookups over it. It also backs `/recall`
without loss (#22).

Both live in the existing `recall/index.sqlite` (one DB per instance, rows keyed by
`session_id`), reached through the existing `getRecallIndex()` singleton and written in
the existing write-through path. We are extending proven infrastructure, not adding a
new store or a new lock primitive.

### Why a counter committed *before* the JSONL append (the crucial choice)

Two durable stores (a JSONL file and a SQLite DB) cannot commit atomically. The design
must stay correct across a crash at any point. The options and why this one wins:

- **Derive seq from `MAX(event_journal)` and insert the journal row + JSONL in one
  flow** — fails: if the journal row commits before the JSONL append and we crash
  between, the journal is *ahead* of the JSONL (a phantom event), or if the JSONL
  commits first and we crash, the next process derives the same `MAX` and assigns a
  **duplicate** seq to a *different* event. Either way the two stores disagree on what
  event owns seq N.
- **Counter committed first, JSONL second** (chosen): the seq is durably *reserved* in
  SQLite before the JSONL append. A crash between the counter commit and the JSONL
  append burns seq N (a **gap**) — the event was never durably written, so losing it is
  correct (the caller never got success). The next append gets N+1. No process ever
  reuses N, so **no duplicate** can reach the JSONL. The JSONL remains the source of
  truth; gaps are harmless because nothing requires gapless seqs (the reducer sorts by
  seq; watermarks compare by seq).

The seq counter is **separate** from the `event_journal` rows. The journal rows are
written **write-through after** the JSONL append (best-effort, exactly the robustness
model the recall index already uses) and **repaired by the startup backfill** from the
JSONL. So:
- The **counter** is the authority for *assigning* seq (must be correct, in a committed
  txn).
- The **journal rows** are a derived read model (advisory, rebuildable from JSONL).

### Append path (new)

Under the runner's existing in-process `runExclusive`, `appendDurableEvent` becomes:

1. `BEGIN IMMEDIATE` on the index DB.
2. `seq = ` atomically bump the per-session counter:
   `INSERT INTO seq_counter(session_id, next_seq) VALUES (?, ?seed+1)
    ON CONFLICT(session_id) DO UPDATE SET next_seq = next_seq + 1 RETURNING next_seq`.
   (`?seed` handles a fresh counter for a session that already has JSONL — see seeding.)
3. `COMMIT`. **Seq is now durably reserved.**
4. Run the existing turn_end dedup as an indexed lookup (see Queries) — if a duplicate
   turn_end, return the existing without consuming… (see "turn_end dedup ordering"
   below — this needs care because the dedup must happen *before* the counter bump, or
   the burned seq is acceptable).
5. Append the event (with `seq`) to the JSONL transcript (source of truth) — unchanged
   newline-guard + chmod.
6. Write-through the `event_journal` row (verbatim line + discriminators) and the recall
   FTS row, best-effort (try/catch, non-fatal), inside one `BEGIN IMMEDIATE` (as recall
   does today).

**turn_end dedup ordering (care):** today the dedup runs first and may return the
existing event without assigning a seq. With the counter-first design, if we bump the
counter then discover a duplicate turn_end, we've burned a seq (a gap) for a write we
drop. Gaps are acceptable, so the simplest correct ordering is: do the dedup query
*before* the counter bump (an indexed `SELECT … WHERE turn_id=? AND type='turn_end'`),
and only bump+append if it's not a duplicate. The dedup query is cross-process-consistent
because it reads committed journal rows; a race where two processes both pass the dedup
and both append is the *same* (already-tolerated) possibility as today, and is bounded
by `runExclusive` within a process and rare across processes.

### Counter seeding (the subtle part)

A session may already have a JSONL log (seq up to N) with no counter row (fresh index,
or index rebuilt). The first counter bump must yield N+1, not 1. So the counter is
**seeded from the JSONL max** once, at session open / backfill (the backfill already
scans the JSONL on startup): `next_seq = MAX(eventSeq in JSONL)`. On open we
**reconcile**: `next_seq = MAX(stored next_seq, MAX(JSONL seq))` so a stale/rebuilt
counter can never hand out a seq at or below what the JSONL already contains. After
seeding, the hot path is pure increment — no scan.

If the counter is *missing* at append time (not yet seeded), the append path must seed
it from the JSONL max within the same `BEGIN IMMEDIATE` before bumping — a one-time
scan for that session, never repeated. (Prefer seeding at open so the hot path never
scans.)

## The `event_journal` table (read model + non-lossy recall)

```sql
CREATE TABLE event_journal (
  session_id        TEXT    NOT NULL,
  event_seq         INTEGER NOT NULL,
  type              TEXT    NOT NULL,
  turn_id           TEXT,
  turn_seq          INTEGER,
  ts                TEXT    NOT NULL,
  idempotency_key   TEXT,
  inject_priority   TEXT,
  line              TEXT    NOT NULL,   -- the verbatim JSONL line (non-lossy)
  PRIMARY KEY (session_id, event_seq)
);
CREATE INDEX ej_turn      ON event_journal(session_id, turn_id);
CREATE INDEX ej_type_seq  ON event_journal(session_id, type, event_seq);
CREATE INDEX ej_idem      ON event_journal(session_id, idempotency_key);
```

- `line` is the **verbatim** JSONL text — replaying it through `readParsedSessionEvents`
  + the reducer yields byte-identical output to reading the JSONL (the Step-0/1 gates
  prove the reducer; the journal just delivers the same input). This is what makes the
  index able to back the hot path and `/recall` without loss (#22).
- Discriminator columns are extracted once on insert so the five queries are pure index
  lookups; the deep-content idempotency check reads `line` and compares (it needs the
  full content, which is why we store the verbatim line, not just columns).

### The five scans → indexed lookups (full history, per session)

| Query | Today (full scan) | Indexed lookup |
|---|---|---|
| next seq | scan max eventSeq | the `seq_counter` bump (above) |
| last turn_end seq | scan for latest `turn_end` | `SELECT MAX(event_seq) WHERE session_id=? AND type='turn_end'` |
| turn_end dedup | scan for `turn_id` match | `SELECT line WHERE session_id=? AND type='turn_end' AND turn_id=?` |
| idempotency | scan prompts, deep-equal content | `SELECT line WHERE session_id=? AND type='prompt' AND idempotency_key=?` then deep-equal on the parsed content |
| immediate injects since | scan events after watermark | `SELECT line WHERE session_id=? AND type='context_injected' AND event_seq>?` then filter `priority='immediate'` |

All are **full-history** (not windowed) — idempotency/dedup must see turnIds and content
from before the last compaction, which the spec requires.

## Invariants (must hold)

1. The JSONL log is the source of truth. The counter and `event_journal` are derived;
   `event_journal` is rebuildable from the JSONL (the backfill). The counter is
   reconciled to `MAX(JSONL)` on open.
2. Seq is unique and monotonic across processes; **gaps are allowed** (a crash between
   counter-commit and JSONL-append burns a seq). Nothing may assume gapless seqs.
3. Seq assignment happens in a committed `BEGIN IMMEDIATE` txn before the JSONL append.
   No code path derives seq from a non-transactional scan on the hot path again.
4. `event_journal.line` is byte-verbatim; replaying it equals reading the JSONL line.
5. Index writes are best-effort + backfill-repaired; an index write failure never fails
   an event append (JSONL is truth). A *seq counter* failure, however, MUST fail the
   append (we cannot append without a reserved seq).
6. On any divergence (journal row missing/mismatched vs JSONL), the JSONL wins and the
   journal is rebuilt; the hot-path queries fall back to / are validated against the
   JSONL by a sampled canary (as the architecture spec requires).

## Crash & concurrency analysis (the load-bearing section)

- **Crash after counter commit, before JSONL append:** seq N burned → gap. Event lost
  (never durable; caller didn't get success). Next append N+1. No dup. ✔
- **Crash after JSONL append, before journal write-through:** JSONL has N, journal
  doesn't. Backfill on next open inserts the journal row from the JSONL. Counter already
  ≥ N. ✔
- **Two processes append concurrently:** `BEGIN IMMEDIATE` serializes the counter bumps;
  A gets N, B gets N+1; both append different seqs to the (possibly different shard)
  JSONL. No dup. ✔ (This is the race the current code loses.)
- **Index DB deleted/corrupt:** on open, recreate schema, backfill `event_journal` from
  JSONL, reconcile counter to `MAX(JSONL)`. Hot path resumes. ✔
- **Counter row stale (< JSONL max), e.g. partial rebuild:** open-time reconcile sets it
  to `MAX(JSONL)`; never hands out ≤ existing. ✔
- **WAL contention / SQLITE_BUSY:** the existing `busy_timeout=5000` + retry covers it; a
  counter bump that times out fails the append (Invariant 5) rather than risking a dup.

## Build order (each independently shippable + measured)

1. **Schema + counter, behind a read-only shadow.** Add `event_journal` + `seq_counter`
   tables (migration in `index-db.ts`, bump `SCHEMA_VERSION`). Backfill populates
   `event_journal` and seeds `seq_counter` from JSONL on startup. **Do not change seq
   assignment yet.** Write-through `event_journal` on append (best-effort). Ship + let
   the backfill/write-through run on Ada; verify the journal matches the JSONL (a
   shadow-compare canary) before trusting it.
2. **Cut the five reads to the index, keep the JSONL fallback + canary.** Replace the
   four scan queries (last-turn-end, dedup, idempotency, injects) with indexed lookups;
   keep a sampled full-scan canary that compares. Seq still disk-derived. Measure.
3. **Cut seq assignment to the counter.** The dangerous one. Counter-first append.
   Exhaustive concurrency tests (two real processes appending; crash-injection between
   counter-commit and JSONL-append asserting gap-not-dup). Retire
   `deriveNextEventSeqAcrossSessionFiles` from the hot path (keep for the canary /
   reconcile). Deploy to Ada behind the canary; watch for any dup/gap anomaly.
4. **Recall non-lossy (#22).** Point `/recall` at `event_journal.line` (or keep FTS for
   search but return verbatim from the journal). All event types, no rendering loss.

## What stays put

- The on-disk JSONL format is unchanged. Old sessions backfill their `event_journal` on
  first open; nothing to migrate.
- `runExclusive` (in-process) stays; SQLite `BEGIN IMMEDIATE` adds the cross-process
  serialization the append path lacked.
- The recall FTS table stays for search; the journal adds the verbatim/full-history
  store.

## Open questions for review

- **turn_end dedup vs counter ordering** — is "dedup query before counter bump" correct
  under cross-process races, or does the dedup itself need to be inside the counter txn?
- **Counter seeding race** — is seeding inside the first `BEGIN IMMEDIATE` (reading
  `MAX(JSONL)`) safe against two processes both seeding, or must seeding be an
  open-time-only step?
- **Sharded JSONL + `MAX(JSONL)` reconcile** — reconcile still needs one cross-shard max
  scan on open; acceptable as cold-path, but confirm it sees every shard (persona/date).
- **Per-session vs per-instance counter contention** — one `seq_counter` table, many
  sessions; `BEGIN IMMEDIATE` is DB-wide in SQLite. Does cross-session append contention
  on one DB-wide write lock become a bottleneck (vs today's lock-free appends)? Measure;
  if so, consider a per-session DB or a sharded counter.
