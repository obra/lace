<!-- ABOUTME: How Lace assigns durable event sequence numbers safely across processes. -->
<!-- ABOUTME: The per-session lock + monotonic head file, reserve-before-append, gaps. -->

# Event sequence authority

Every durable event in a session's JSONL transcript carries a monotonic
`eventSeq`. Sequence numbers are assigned under a **per-session file lock** from
a **monotonic head file**, using **reserve-before-append** so a crash yields a
gap rather than a duplicate. The JSONL is the source of truth; the head file is
the seq authority, reconciled against the JSONL on open.

## The mechanism

Each session directory holds:

- `<sessionDir>/.seq` — the head file: a single integer = the **next-free** seq.
- `<sessionDir>/.seq.lock` — a `mkdir`-based cross-process advisory lock.

`appendDurableEvent` runs, under the lock:

1. Read (or seed) the head `H`. The head is seeded on first use from
   `MAX(eventSeq across the session's JSONL shards) + 1`.
2. Write `H + 1` to the head file — **reserving** `H` before appending.
3. Append the JSONL line with `seq = H`.

The lock is held across the JSONL append, so reading `MAX(JSONL)` for seeding and
the turn_end dedup both see a stable log with no concurrent appender interleaving.
The recall/journal index write-through happens outside the lock — it is
best-effort and never on a correctness path.

## Why reserve-before-append

The head file and the JSONL are separate files with no shared transaction. A
crash after the head is advanced but before the JSONL append **burns `H`** — the
event was never durable, the caller never saw success, and the next append gets
`H + 1`. No interleaving can produce a duplicate; the worst case is a gap.

## Reconcile on open

When a session is opened, the head is reconciled monotonically:
`head = MAX(readHead() | 0, MAX(JSONL) + 1)`. This only ever moves the head
**up**, so a stale or lost head (an un-fsync'd write lost to a crash, a head that
never existed) can never hand out a seq `<=` an existing JSONL seq.

## Sequence numbers are unique and monotonic; gaps are normal

`eventSeq` is unique and strictly increasing across processes. **Gaps are
expected** — a burned reserve leaves a hole — and every consumer tolerates them:
the reducer sorts by seq, watermarks compare with `>` / `<=` (never `+1`),
checkpoints match exact stored seqs, and range reads tolerate missing neighbors.
Nothing assumes gapless seqs. `SessionState.nextEventSeq` is advisory only: it is
derived from the reconciled head on open and never drives assignment, and a gap
no longer triggers a state-file rewrite.
