# Transcript startup: root cause and private qualification

Runtime candidate: `aab50b469490372817c4b2bec795e123e0f44614`. Status: privately
validated; not merged or deployed. Both independent Sol implementation reviews
found no remaining actionable issue. Ada stays on her operator's rollback.
Reeve's semantic-search/publication incident remains open.

## Root cause

Startup queried `events WHERE session_id = ?` once per session. This is an FTS5
table with `session_id UNINDEXED`. The frozen copy had 1,085 sessions and
161,363 FTS rows, causing about 175 million row checks. The profile attributed
92.639 of 98.471 sampled seconds to the lookup call. This is sampled elapsed
time, not host CPU utilization. The query predates Lace #465; that change moved
the synchronous scan ahead of accepting requests. Neither embeddings nor Qdrant
participates in this backfill.

One ordinary identifier table now supports indexed session membership and
duplicate checks. FTS remains version 3. FTS, key and marker writes use one
transaction/savepoint; prior-writer appends reconcile under the write lock. The
current-schema open path remains readable while another connection writes.

## Measurements

These are local runs on preserved private inputs, not live Ada measurements. The
database and transcript archive were copied at different times; the 24
insertions below are identical in baseline and candidate.

| Run                                                |  Elapsed | Transcript events scanned | FTS rows inserted | Errors |
| -------------------------------------------------- | -------: | ------------------------: | ----------------: | -----: |
| Baseline `55c58fa0a`                               | 98.424 s |                   217,361 |                24 |      0 |
| Initial candidate `5ec968b7a`, normal startup path |  7.992 s |                   217,361 |                24 |      0 |
| Initial candidate, subsequent startup              |  2.669 s |                   217,361 |                 0 |      0 |
| Final candidate, separated import and catch-up     |  8.106 s |                   217,361 |                24 |      0 |
| Final candidate, subsequent normal startup         |  3.691 s |                   217,361 |                 0 |      0 |

The final first-run measurement deliberately calls the same reconciliation
helper in its own immediate transaction before backfill: index open 0.003 s,
identifier import/transaction 4.488 s, backfill 3.615 s. This separates the
one-time import from recurring work. It is not a separate normal-startup timing.
All earlier runs remain preserved rather than selecting the fastest result.

On the populated copy, an absent-session lookup changed from an FTS scan with
484,098 SQLite instructions and 92,483 page-cache misses to an indexed lookup
with 8 instructions and 3 misses. The absent-event lookup uses the covering
primary-key index: 7 instructions and 3 misses. Page-cache misses are not a
measurement of physical disk reads. The database grew by 35,057,664 bytes (about
33.4 MiB) for the persisted identifiers and indexes.

## Correctness and review

- Full stored FTS content and journal hashes match the completed baseline.
- Three fresh text-search probes have identical complete results, including
  rowids. Original database and transcript-archive SHA-256 values are unchanged.
- Actual built `d0834134` storage code can append after upgrade. The candidate
  recognizes those appends without duplication both after reopening and while
  its original connection remains open. Existing FTS/journal rows survive.
- Deterministic SQLite regressions cover competing writers, a caught row-write
  failure, current-schema readers during writes, and a competing schema rebuild.
  The final focused run passed 185 tests.
- The final isolated Linux `npm test` exited 0: 4,852 passed, 67 skipped. It
  used two CPUs, 6 GiB, no network and the matching package lock. Its container
  was removed after preserving logs and exit state.
- The earlier Mac full suite is retained: 21 failures, including hardcoded Node
  path, `/proc` and GNU-find assumptions plus one memory-review timeout. The
  Linux run exercised that memory-review test successfully. This does not claim
  every Mac failure was repaired. Expected provider-deprecation warnings remain.

Private receipts are under `/Users/jesse/.cache/recall-latency.ol1gLr/`, notably
`ada-backfill-baseline/`, `ada-keys-final-first/`, `ada-keys-final-steady/`,
`ada-keys-rollback/`, `ada-keys-linux-suite.log`, and the preserved hash/probe
receipts. No private transcript text is included here.

## Remaining startup work

Backfill still rereads every transcript on startup. `appendDurableEvent` writes
JSONL first, then attempts FTS and journal writes separately; it deliberately
logs index failures without failing the transcript append. Full startup scans
repair these gaps and admit older history. Native workers use the same
entrypoint.

The identifier marker tracks imported FTS rowids, not how far a transcript file
has been read. This repair therefore removes repeated full-database scans but
does not make startup independent of history size. A separate incremental
catch-up design should record a successfully processed contiguous file prefix,
avoid skipping gaps after failed writes, and retain a deliberate full-repair
path. That design is not implemented or approved by this qualification. The
earlier live turn that stalled before its first model call remains unresolved.
