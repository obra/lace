# Indexed transcript identifiers

Status: proposed, not implemented. This is separate from the deployed pending
memory-vector selector repair. Ada remains on her operator's rollback.

## Measured problem

On a private copy of Ada's transcript index and original transcript files, the
actual startup backfill took 98.42 seconds. About 94% of sampled elapsed time
was in the per-session query against the FTS table's unindexed `session_id`. The
run scanned 217,361 events and added 24 FTS rows. A normal absent `event_id`
lookup also scans the FTS table: 484,100 VM steps and 0.11 seconds on this copy.
The existing FTS virtual table cannot accept an ordinary B-tree index.

The preserved corpus contains 1,085 distinct sessions and 161,363 FTS rows. The
loop therefore performs about 175 million row checks. The profile assigns
92.638712 of 98.471250 sampled seconds to `backfillIndex`; 73,898 of its 73,902
position samples point to the compiled `haveStmt.all(sessionId)` line. An
independent read-only session lookup reports
`SCAN events VIRTUAL TABLE INDEX 0`, 484,098 VM steps and 92,483 SQLite
page-cache misses. Those misses measure SQLite page-cache work, not physical
disk reads. That separate lookup took 4.01 seconds; its elapsed time is not
substituted into the earlier run.

The query and schema are unchanged between `d0834134` and `e388a3ff`. Lace #465
moved synchronous backfill ahead of installing the request handler, making the
existing cost block startup completely. The 94% is a share of sampled elapsed
time, not a measurement of host CPU utilization. Embeddings and Qdrant are not
in this backfill path.

The live restart log has adjacent startup markers almost eight minutes apart,
ending in a backfill that inserted nothing. This identifies an expensive startup
path. It does not establish the cause of the earlier live-turn stall: that turn
started at 04:49 but never logged its first root model request.

## Small repair

Keep the current FTS content, verbatim journal, original JSONL and public recall
API. Add one ordinary metadata table in the same SQLite database containing
`event_id` (primary key) and `session_id`, with an index on `session_id`.
Backfill's session membership lookup and normal writes' duplicate check use this
table. Do not load all identifiers into a process-wide memory cache.

Populate the metadata from existing FTS rows once. Keep the last examined FTS
rowid in the existing `_meta` table. Under the existing immediate write
transaction, import any later FTS rows before consulting the metadata. A normal
new write inserts its FTS row and identifier together and advances that marker
atomically even when a backfill caller catches a per-row failure and continues
its outer transaction. Use a per-event savepoint; never advance the marker past
an unrecorded identifier. Recheck the import marker and read session membership
after acquiring the write lock, so concurrent processes share one import.
Existing duplicate FTS rows remain untouched; their identifiers use
`INSERT OR IGNORE`. The scan marker advances past duplicates too. When Lace
rebuilds its FTS schema, reset this derived metadata atomically with it. Keep
FTS `SCHEMA_VERSION=3`: the additive metadata does not change that schema, and
the actual prior binary would drop FTS on a version mismatch.

This tail reconciliation preserves the actual prior runtime's append behavior:
`d0834134` can ignore the additive table, and a subsequent upgrade catches up
rows it wrote. It also covers a prior writer sharing the database. This is an
explicit compatibility decision, not permission to support arbitrary old schemas
or manually edited/corrupt indexes. The previous binary uses the same FTS schema
version 3. No FTS rebuild, deletion of history, queue, background service or new
archive is proposed.

## Validation before rollout

Use the same frozen populated inputs once for the candidate, with preserved
baseline receipts. Check the one-time import, subsequent lookup plans and
write-lock duration separately from steady-state backfill. Check unchanged
search results and journal rows, and missing events in the middle of a
transcript. Exercise concurrent writers with deterministic ordering. Use the
actual prior binary to append after rollback, then verify a new open and insert
catch those rows without duplicate FTS data. Also verify an old-binary append
while an upgraded connection stays open, and an injected failure between the FTS
and metadata writes inside backfill. Two independent Sol reviews and the normal
full CI gate apply.

The remaining JSONL scan and per-session memory use remain visible. This repair
removes the measured repeated full-index scans; it does not claim constant-time
startup for years of history or resolve the separate pre-provider stall.

Private evidence: `/Users/jesse/.cache/recall-latency.ol1gLr/`, including
`ada-backfill-baseline/stats.json`, the CPU profile and immutable source hashes.

Two independent Sol design reviews accepted the approach subject to the
transaction and schema-version details stated above. Both reviewed the measured
cause and kept the separate live-turn stall outside this conclusion.
