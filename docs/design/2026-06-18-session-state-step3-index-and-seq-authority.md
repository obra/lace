# Session-State Step 3 — Cross-Process Seq Authority + Recall Index (design, rev2)

Status: design intent, hardened after a two-reviewer adversarial pass that found the
rev1 (SQLite-counter) design corruption-prone. This is the linchpin the architecture
spec flagged as "the part most likely to be wrong if rushed" — a mistake corrupts the
durable log. Read the crash/concurrency analysis as the load-bearing section.

## The one principle rev1 violated

**Correctness decisions read the JSONL (the source of truth), serialized by a
per-session file lock. The SQLite index is only a read/recall cache and is never on a
correctness path.**

Rev1 tried to make a best-effort, lagging SQLite index the authority for seq
assignment, turn_end dedup, idempotency, and the injects watermark. The reviewers
showed every one of those is unsafe: the index lags the JSONL (write-through is
best-effort, backfill runs *after* the RPC server is live), so the index can be behind
the truth and produce a duplicate seq, a duplicate turn_end, a re-run prompt, or a
**silently dropped cross-process inject**. Rev2 keeps every correctness decision on the
JSONL under a real cross-process lock, and uses SQLite only for non-lossy recall (#22).

## The problem (unchanged)

Per-turn cost is dominated by full-log scans:
- `deriveNextEventSeqAcrossSessionFiles` — a full O(events) scan **on every append**
  (5-8/turn) to compute the next `eventSeq`, run **outside any cross-process lock**.
  Two processes appending to the same session concurrently (the inject path is
  cross-process and live) can both derive the same seq and write a **duplicate** — a
  latent corruption race that exists today.
- `readImmediateInjectsSince` — a full scan **per loop iteration** (1-8/turn) for
  cross-process injects.
- `findLastTurnEndEventSeq`, `findTurnEndEventByTurnId` (dedup), `classifyPromptHandoff`
  (idempotency) — full scans, but each runs **once per turn / per prompt**, not per
  append, so they are not the per-append bottleneck.

## The design (rev2)

### 1. Seq authority = per-session flock + monotonic head file

A per-session **advisory file lock** (`<sessionDir>/.seq.lock`, via `proper-lockfile`
or an equivalent battle-tested cross-process lock) and a per-session **head file**
(`<sessionDir>/.seq` holding a single integer = the next-free seq).

`appendDurableEvent` becomes (the lock is held across the JSONL append — that is what
makes seeding and assignment race-free):

```
acquire flock(sessionDir)            // cross-process serialization of ALL appenders
try:
  H = readHead(sessionDir)           // O(1); if missing → seed (below)
  writeHead(sessionDir, H + 1)       // RESERVE H by advancing the head FIRST
  appendJSONL(seq = H, event)        // source of truth
finally:
  release flock
writeThroughRecallIndex(event)       // best-effort, OUTSIDE the lock (not correctness)
```

**Why reserve-before-append (head written before the JSONL append):** the head file
and the JSONL are separate files; there is no transaction to roll back. A crash after
`writeHead(H+1)` but before the JSONL append **burns H** (a gap) — the event was never
durable, the caller never got success, losing it is correct, and the next append gets
H+1, never H. A crash after the JSONL append is impossible to leave inconsistent
because the head was already advanced first. **No interleaving yields a duplicate; the
worst case is a gap, which every consumer tolerates** (the reducer sorts by seq;
watermarks compare with `>`/`<=`, never `+1`; checkpoints match exact stored seqs;
recall range reads tolerate missing neighbors — verified across the codebase by both
reviewers).

This is self-contained per session: **no SQLite, no DB-wide lock, no cross-session
contention** (rev1 Finding A3 dissolved). The flock is also a genuine correctness fix
for the dup race that exists today.

#### Head seeding and reconcile (exact semantics — rev1 was ambiguous here)

The head file stores the **next-free** seq (not the last-consumed). Two rules, stated
once and unambiguously:

- **Seed (head file missing):** done **inside the held flock** on the first append (or
  at session open). `head = MAX(JSONL seq across all shards) + 1`. Reading `MAX(JSONL)`
  under the flock is race-free because every appender holds the flock, so no concurrent
  append can land between the scan and the first reserve. (`deriveNextEventSeqAcross
  SessionFiles` already returns `MAX+1` across legacy + all persona/date shards — reuse
  it for the seed.)
- **Reconcile (head file present, on open):** `head = MAX(readHead(), MAX(JSONL)+1)`.
  This is monotonic-merge — it can only move the head **up**, never down, so a stale or
  lost head (e.g. an un-fsync'd write lost to a crash, or an index/state rebuild) can
  never hand out a seq `≤` an existing JSONL seq. The `+1` is load-bearing (the head is
  next-free; `MAX(JSONL)` is last-consumed).

No per-append fsync of the head is required: the head is read fresh under the flock each
append (so it reflects the last in-process write via the page cache), and a crash that
loses an un-fsync'd head write is caught by the open-time reconcile against the JSONL.

#### `session/fork` (rev1 Finding B7)

Fork copies events with raw `appendFileSync`, preserving original seqs, and never calls
`appendDurableEvent`. That is fine under rev2: the forked session has **no head file**,
so the first real `appendDurableEvent` to it seeds the head from `MAX(copied JSONL)+1`
under the flock. Because a fork creates a brand-new session that nothing else is
appending to yet, there is no race. (We additionally write the head at fork time as an
optimization, but correctness does not depend on it — the lazy seed covers it.)

#### `SessionState.nextEventSeq` (rev1 Finding A5/B5)

The head file is the **sole** seq authority. `SessionState.nextEventSeq` is **retired
as an authority**: nothing assigns a seq from it (today nothing does — assignment is
`deriveNextEventSeqAcrossSessionFiles`). We stop `loadSession` from repairing/rewriting
`state.nextEventSeq` from a JSONL scan (it would perpetually "mismatch" once gaps exist,
rewriting state on every open). Either drop the field or mark it advisory/derived; the
corruption guard that field once served (`readSessionState`) is replaced by the head
reconcile. This must be explicit in the plan so two "next seq" sources cannot drift.

### 2. Injects = JSONL byte-offset tail-read (rev1 Finding B3 — the dangerous one)

`readImmediateInjectsSince` must NOT read the lagging index (a cross-process inject in
the JSONL but not yet journaled would be **silently dropped** — a lost notification,
not a safe redo). Instead, read the JSONL **incrementally by byte offset**: track the
last-read byte offset per shard file; each call reads only `[offset, EOF)`, parses the
newly-appended lines, advances the offset. Append-only files mean cross-process injects
land at the end and are seen immediately, with **O(new bytes)** work instead of
O(all events). Handle the rare new-shard case (cross-midnight / persona change
mid-turn) by detecting a new shard file and reading it whole from offset 0. This reads
the truth, never lags, and removes the per-iteration full scan — the second bottleneck.

### 3. dedup / idempotency / last-turn-end = stay on the JSONL

These run **once per turn / per prompt**, not per append, so they are not the
per-append bottleneck and do not need the index:

- **turn_end dedup** (`findTurnEndEventByTurnId`): keep reading the JSONL, now **inside
  the flock**, so the one-turn_end-per-turnId invariant is enforced against the truth
  and is race-free (rev1 Findings A1/B9 dissolved — the flock serializes, and we read
  the source of truth, not a lagging store). In practice turn_ends are written only by
  the owning runner (in-process, already serialized by `runExclusive`), so the
  cross-process case is rare regardless; reading the JSONL keeps it correct.
- **idempotency** (`classifyPromptHandoff`): keep on the JSONL. It needs the matched
  prompt's content deep-equal AND the later-same-turn-events check (rev1 Finding B4) —
  both already work over the JSONL event set; no change, no regression. It runs once at
  prompt handoff; the Step-2 parse-once already made the turn-entry read efficient.
- **last-turn-end seq**: already served by `loadTurnEntryProjection` (Step 2) from the
  single turn-entry parse. No per-append cost.

So Step 3 does **not** move dedup/idempotency to SQLite at all. That removes rev1
Findings A1, A4, B4, B9 entirely.

### 4. `event_journal` (SQLite) = recall non-lossy only (#22)

A new `event_journal` table in the existing `recall/index.sqlite`: one row per event,
`(session_id, event_seq, type, ts, line)` with `line` = the verbatim JSONL text, plus
the FTS content for search. Purpose: `/recall` returns the **verbatim** event (no
rendering loss, all event types), instead of today's lossy FTS-only rows. It is written
by a **dedicated, unfiltered writer** (not `eventToRow`, which returns `null` for
turn_end/system_prompt_set/etc — rev1 Finding B6), best-effort write-through + startup
backfill (exactly today's recall robustness model). **Nothing correctness-critical reads
it**, so its lag is harmless. This is the #22 deliverable and is independently shippable
first (lowest risk).

## Invariants (rev2)

1. JSONL is the source of truth. The head file is the seq authority (reconciled to the
   JSONL on open). The SQLite index is a derived recall cache, rebuildable from the
   JSONL, never on a correctness path.
2. Seq is unique and monotonic across processes; **gaps are allowed** (a crash between
   head-reserve and JSONL-append burns a seq). Nothing assumes gapless seqs.
3. Every append holds the per-session flock across the JSONL write; seq assignment,
   head seeding, and turn_end dedup happen under that lock, reading the JSONL.
4. The head reconcile is monotonic: `head = MAX(readHead(), MAX(JSONL)+1)` on open;
   it can never move down.
5. The injects watermark reads the JSONL by byte offset (truth, no lag). It never reads
   the SQLite index.
6. `SessionState.nextEventSeq` is not a seq authority and is not repaired from a JSONL
   scan on load.
7. Recall index writes are best-effort + backfill-repaired; a recall write failure never
   fails an append. (Seq assignment is a *file* operation under a *file* lock, not a DB
   op — so DB unavailability cannot fail an append. Rev1 Finding A3 dissolved.)

## Crash & concurrency analysis (load-bearing)

- **Crash after head-reserve (H+1 written), before JSONL append:** H burned → gap.
  Event lost (never durable; caller didn't get success). Next append H+1. No dup. ✔
- **Crash after JSONL append:** head was already advanced first → consistent. ✔
- **Two processes append concurrently:** the flock serializes them; A reserves H and
  appends, releases; B reserves H+1 and appends. No dup. ✔ (the race today's code loses)
- **Head file lost / un-fsync'd write lost to a crash:** open-time reconcile sets
  `head = MAX(readHead()|0, MAX(JSONL)+1)` → never ≤ an existing JSONL seq. ✔
- **Fork:** new session, lazy seed under the flock from `MAX(copied JSONL)+1`, no race. ✔
- **Stale flock (process died holding it):** `proper-lockfile` reclaims a stale lock by
  mtime/staleness; the plan must set a sane staleness and verify reclaim. (Open item.)
- **Recall index unavailable/locked/disk-full:** swallowed (best-effort); append still
  succeeds (seq + JSONL are file ops). Backfill repairs the index later. ✔

## Build order (each independently shippable + measured; safest first)

1. **`event_journal` recall non-lossy (#22)** — lowest risk, no correctness path. Add
   the table + unfiltered write-through + backfill; point `/recall` at the verbatim
   line. Ship + verify recall fidelity on Ada. This proves the index plumbing with zero
   risk to the log.
2. **Injects byte-offset tail-read** — replace `readImmediateInjectsSince`'s full scan
   with the incremental offset reader. Pure read change, reads the truth. Differential
   test vs the full-scan over fixtures incl. cross-process injects + cross-shard. Ship +
   measure (removes one bottleneck).
3. **Seq = flock + head file — THE DANGEROUS ONE.** Add the per-session flock + head
   file; reserve-before-append; seed + reconcile per the exact semantics above; retire
   `SessionState.nextEventSeq` as authority and stop the `loadSession` repair-rewrite.
   Tests: two real concurrent processes appending (assert unique, monotonic, no dup);
   crash-injection between head-reserve and JSONL-append (assert gap, not dup); fork
   seed; stale-lock reclaim; reconcile after a lost head. Keep
   `deriveNextEventSeqAcrossSessionFiles` only for the seed/reconcile scan and a
   debug/validate path. Deploy to Ada and watch for any seq anomaly (a tail-read over
   her live log asserting strictly-increasing-with-gaps, no dups).

## What stays put

- The on-disk JSONL format is unchanged. Old sessions seed their head from `MAX(JSONL)`
  on first open; nothing to migrate.
- `runExclusive` (in-process) stays; the per-session flock adds the cross-process
  serialization the append path lacked.
- The recall FTS table stays for search; `event_journal` adds the verbatim store.

## What review changed (rev1 → rev2)

A two-reviewer competitive pass found rev1 (SQLite-counter as seq authority + index for
dedup/idempotency/injects) corruption-prone. Every fix below traces to a finding:
- **Seq authority moved from a shared-SQLite counter to a per-session flock + head
  file.** Dissolves: DB-wide contention + seq-on-critical-path append failure (A3); the
  seeding TOCTOU because DB-lock ≠ JSONL-lock (A2) — now the flock is held across the
  JSONL append; the ambiguous off-by-one reconcile (B1) — now stated once as
  `MAX(stored, MAX(JSONL)+1)`, head = next-free; the backfill-clobbers-counter race
  (B2) — no counter, head is per-session under the flock; the fork-with-no-seed dup
  (B7) — lazy seed under the flock.
- **Injects keep reading the JSONL (now by byte offset), never the index** (B3 — the
  silently-dropped cross-process inject).
- **dedup + idempotency stay on the JSONL** (A1, A4, B4, B9) — never moved to the index;
  idempotency keeps its later-same-turn check intact.
- **`event_journal` gets a dedicated unfiltered writer** (B6) and is recall-only.
- **`SessionState.nextEventSeq` retired as authority + no load-time repair** (A5, B5).
- **The canary is no longer load-bearing for seq** (A6, B8): seq correctness comes from
  the flock + reserve-before-append + reconcile, which *prevent* dups, rather than a
  sampled canary that could only *detect* an unrecoverable dup after the fact.

## Open items for the plan

- Pick + verify the cross-process lock library (`proper-lockfile` vs a native flock);
  confirm stale-lock reclaim semantics and a staleness threshold that can't falsely
  reclaim a slow-but-live append.
- The byte-offset inject reader's shard/rotation handling (cross-midnight, persona
  change) — enumerate and test.
- Confirm every `appendDurableEvent` caller goes through the locked path (the inject
  path at `session-operations.ts`, the runner's `writeAndAdvance`, fork) — no raw
  `appendFileSync` to a live session outside fork.
