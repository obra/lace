# Persistent memory search

Jesse approved this direction on 2026-11-10: use an established vector search
engine, starting with a private populated-index trial, and carry the project
through implementation and the Reeve-only pilot. This supersedes the proposed
packed-vector optimization. Existing databases, experiments and model assets
remain intact.

## Decision

Use Qdrant Server as a private derived index alongside each Sen colleague.
SQLite remains authoritative for memories, revisions, permissions and original
source references. The existing local EmbeddingGemma encoder, explicit memory
tools, root-only automatic recall, text-only error fallback and evidence
presentation remain the product contract.

Qdrant owns persistent vector storage, indexed/exact search and background
segment maintenance. Lace publishes incremental changes with stable passage
identities, records durable publication progress and validates retrieved IDs
against SQLite. A failed derived index must not lose original memories or make
stale versions authoritative. Query preparation must not rebuild the index or
deserialize all stored vectors.

The alternatives were LanceDB Embedded (fewer deployment components, but Lace
owns scheduling index catch-up and cleanup) and sqlite-vec (a useful native
exact baseline; its current ANN implementation is prerelease). Qdrant is
preferred for managed index maintenance and separate process resource controls.
Its fit must be measured, including maintenance peaks; disk storage is not a RAM
cap.

## Qualification before runtime replacement

The first deliverable is a reusable developer benchmark, not a runtime toggle.
Use an immutable private SQLite snapshot and its existing 768-dimensional
vectors. Record the exact generation and dataset digest. Do not re-embed the
corpus. Encode a frozen query panel once and reuse those query vectors.

Use Qdrant 1.20.0 pinned by image digest. Start with Float32/Dot to match the
existing normalized dot-product scoring without extra normalization or
quantization. Use cold vector storage, a cached HNSW graph, m=16,
ef_construct=100, one indexing thread and one optimizer job. New points remain
searchable before optimization: do not enable indexed_only or
prevent_unoptimized. Upserts/deletes use wait=true and only a completed result
counts as publication. Read the API key from a private file, disable outbound
usage telemetry, and expose no public network listener.

Compare exhaustive JavaScript reference results, native exact search and
HNSW-enabled search with hnsw_ef=128 for 100 candidates. Save collection state
and details_level=4 telemetry around queries to establish whether HNSW ran; the
planner can choose exact scans. Label execution order because an exact query
warms disk pages for a following approximate query. Treat score differences
within 1e-5 as numerical ties; report raw disagreements too. Independently
rescore returned boundary IDs from SQLite; an engine score cannot certify an
unknown ID as a tie. These measurements do not establish answer quality or
preserve the semantic/text/identifier union by themselves. The runtime phase
must retain those routes and validate selected evidence and delivered answers.

Record import and indexing separately from first/warm query times. Exercise
bounded upserts, a new revision ID, deletion, idempotent replay and restart with
persisted storage. A fresh container must read the live sentinel and confirm the
deleted IDs absent before any writes. This tests engine recovery, not the future
Lace publication cursor. Use a private standalone SQLite backup in DELETE
journal mode, reject WAL/SHM siblings and hash around prepare/import. Preserve
every result and error. Reuse the existing native-worker evaluator for final
concurrency and full-preparation measurements, after the runtime integration
exists. The first server trial is limited to 2 CPUs/4 GiB and runs alone; later
whole-stack measurements retain the existing 2 CPU/6 GiB lab envelope. No claim
of production speed follows from an emulated or differently resourced run.

## Runtime follow-through

The populated qualification supports native exact queries for initial
integration. HNSW at ef=128 did not preserve the nearest candidates. See the
[aggregate results](../../research/long-horizon-memory/persistent-search-2026-11-10/README.md).
Do not change the collection settings during the first integration; retain the
measured configuration and issue `exact: true`. This is not a claim of sublinear
scaling.

### Engine boundary

Use one internal `MemorySearchIndex`, backed by Qdrant's HTTP API. It is not a
public search-backend framework. Its constructor takes a loopback URL, an
optional private API-key file, the SQLite instance ID and encoder generation.
The host supplies these values; model input and persisted session configuration
do not. Read the key once and never log it. Sen can share the existing proxy
network namespace and bind the engine to loopback without publishing a host
port.

The collection name is deterministically scoped to instance and generation.
Collection metadata must match both, a fixed projection format, and a random
incarnation created with that collection. An existing mismatched collection is
an error, never an overwrite. A missing collection may be created by the
publisher, not implicitly by a query. Returning its incarnation lets durable
publication notice a lost/recreated derived index and reseed existing vectors.

Passage identity includes source ID, source version, start and end. Note
identity includes note ID and revision. Deterministic UUIDs additionally include
the encoder generation. Payloads contain only these identities, not memory prose
or authority claims. The client supports ensure, bounded upsert, removal and
exact query. Successful writes require `wait=true` and a `completed` result.
Queries return bounded identities/scores, without vectors. Validate dimensions,
finite scores, unique returned IDs and identity/generation agreement. Use caller
cancellation; transport errors propagate to existing text-only fallback.

### Durable publication

SQLite gains only disposable publication metadata and a pending-change table.
Initialize them after root authority admission. Record vector changes in the
same SQLite transaction as the existing vector write. Seed already-stored
passage and current-note vectors in bounded pages, with durable progress tied to
the collection incarnation. Reopening the same collection resumes progress;
recreation requires a fresh seed. Neither operation re-embeds existing vectors.

Pending work identifies the passage or note revision; publication resolves its
current SQLite state before sending a bounded batch. A vanished or invalidated
entry removes that point. Stable IDs make repeating a completed remote update
safe. Clear only the exact pending sequence acknowledged by the server, after
rechecking root ownership, so a concurrent replacement remains pending. A failed
or interrupted request leaves the work durable. Existing revisions and originals
are never rewritten by search publication.

Use two SQLite tables: one state row holding generation, collection incarnation,
passage/note seed cursors and completion, and a pending table with an
autoincrement sequence and unique serialized identity. Triggers enqueue vector
insertion/replacement/update/deletion and invalidate the previous note revision
when its current note is replaced. Account for the existing `INSERT OR REPLACE`
writers explicitly; do not rely on SQLite replacement firing delete triggers.
Installing the tables and triggers is one authorized SQLite transaction. Capture
the old passage identity before replacement by its SQLite key
`(id,version,start)`, even if the new row has no vector or a different end.
Every enqueue of the same identity receives a fresh sequence, so an older
in-flight acknowledgment cannot consume it.

Seed metadata in pages of 128 and checkpoint the page in the same transaction
that enqueues it. Interleave seeding with draining pending pages. Resolve
vectors only for the pending page; passage lookup joins the admitted source
version, and note lookup requires the current note revision and encoder
generation. Use separate upsert/delete requests for a page and acknowledge it
only after both succeed. Cancellation or ownership loss preserves unacknowledged
entries. Check root write authority before each remote mutation and inside the
local acknowledgment transaction. Because ensure awaits a read before creating a
missing collection, it accepts a required `beforeCreate` callback and invokes
that guard immediately before creation. Publisher upsert/delete pages never
exceed one client write batch. After a completed seed and empty queue, the
publisher performs no seed/corpus scan. Existing discovery and embedding
maintenance are separate. This state is a derived-index work queue, not another
memory archive.

Use the existing root maintenance lifetime, with no child publisher or new
polling service. Only a root with mutation authority initializes or runs it.
Start seed/drain independently of embedding: existing vectors and queued
invalidations must progress even when model loading fails or embedding pauses
for a foreground request. Coverage remains explicitly partial during
seed/catch-up or an unverified incarnation. Invalidate in-process readiness
before ensuring the collection, then bind the returned incarnation and seed
state atomically before declaring it ready. A known missing collection also
invalidates the client's cached validation.

Operational restore rule: restoring an older SQLite snapshot also requires a
fresh owned derived collection/volume and reseeding. A normal process reopen of
the current SQLite database resumes the existing collection. Do not invent a
reconciliation protocol for restoring only one half of that pair.

Returning to a previously used encoder generation also requires a fresh derived
collection and reseeding. An inactive generation's collection does not receive
the active generation's deletions. This pilot keeps the encoder generation
fixed; no multi-generation reconciliation is needed.

### Query integration

Keep the existing semantic floor, literal-term admission, exact-identifier
priority, source validation, grouping and packing. Qdrant calculates vector
scores; SQLite supplies candidate text and authoritative current identities.
Neither normal retrieval nor its error fallback decodes the corpus vectors.

Extend the internal client with bounded exact-query pagination and scoring of an
explicit bounded set of point identities. The first uses Qdrant's offset and
score threshold. The second uses its point-ID filter, without a score threshold,
so text-admitted candidates below the semantic floor retain their vector-based
order. Both return only identities and scores, validate their results, and use
the existing cancellation/error rules. Pages contain at most 1,024 hits;
publication remains at 128 points per write. These are internal search methods,
not a general filter language or backend framework.

Qdrant's Dot threshold is strict. The client sends the largest Float32 threshold
strictly below the caller's inclusive floor and restores returned scores to
Float32 before local comparison. This avoids excluding the first qualifying
score when the configured floor rounds upward. The page limit bounds the
response, not native work: Qdrant internally retrieves the prefix through offset
plus limit. Record page count/largest offset and whole-process resources in the
populated measurement.

Read semantic hits in pages through the existing floor, without a fixed total
candidate cutoff. Resolve each identity by SQLite key, checking passage end,
stored generation/vector presence and current note revision. Then enumerate
passages belonging to the existing FTS-hit source identities and the FTS-hit
current notes, in bounded pages. Score only text candidates not already
nominated by the semantic route. The request-private scratch database dedupes
point identities and retains the existing exact/score/source ordering. A note's
vector and prose still nominate its earliest supporting passage; that is a
distinct candidate from the passage's own vector.

After an awaited explicit-score call, re-resolve the complete candidate identity
before using its score or prose. A revised note or changed passage cannot keep
its previous nomination merely because its supporting original is still valid.

Keep the existing validation and packing pass over the complete admitted union,
including refill after invalid or already represented evidence. An engine error
at any stage discards the in-progress semantic ranking and reranks text hits
using the existing text-only rule, with an explicit fallback reason. It never
mixes a half-failed semantic ranking into a text-only result or launches a local
vector scan. No query creates, rebuilds or waits for the publisher. Seed and
pending publication make coverage partial; newly unindexed text remains usable.

The engine's Float32 scores may reorder numerical ties; the qualification
records that boundary. Pagination is not a cross-request index snapshot. SQLite
identity and source checks remain authoritative under concurrent updates, as
they do today. Test nomination/selection against a frozen exhaustive reference
and measure the complete path before claiming a speed improvement. The retained
FTS materialization and request-private ranking may still cost time; this change
does not claim to eliminate every corpus-dependent operation.

The runtime records an in-process publication epoch at the start and settlement
of each coalesced publication run. Recall captures it before nomination and
after validation. An epoch change or observed pending publication marks coverage
partial, including a whole completed write between page requests. Offset
advances by raw engine hits, not hydrated or admitted hits. Dedupe cannot
recover a point skipped by concurrent offset shifts; do not claim a consistent
snapshot or retry the request. Semantic hits compute both semantic and textual
flags before dedupe. A missing engine score for a locally indexed text candidate
keeps that candidate at the existing missing-vector score of -1 and marks
coverage partial.

Fold the final coverage observation into the result before evidence is rendered,
so model-visible coverage and diagnostics agree.

### Lace configuration and lifetime

Add optional trusted `recall.search: {url, apiKeyFile?}` to `initialize.memory`.
The concrete client validates its literal loopback endpoint and optional key.
Without a configured search index, automatic recall explicitly falls back to
text; it does not keep the replaced JavaScript vector path. The memory
database/model configuration and explicit tools remain independent. Children
continue receiving only database identity and role binding, without automatic
recall or the search endpoint.

Construct one client per configured runtime and one publisher only for a root
with mutation authority. Use an internal injected search-client dependency for
unit fixtures, matching only the concrete client's public methods; do not add a
public pluggable-backend API. Automatic retrieval needs only query and scoring.

The existing `wake()` starts publication immediately, independently of discovery
and encoding, and joins that work. Once both initial publication and local
projection/vector work settle, request a fresh drain for the queued changes,
including when encoding fails after some successful writes. Waiting for the
initial run prevents coalescing from swallowing the final drain. Coalesce all
publication under its own lifetime promise, use the existing maintenance tick
and append events, and report failures without blocking core startup or losing
the queue. Closing aborts pending search work before closing SQLite; combine the
turn and runtime abort signals for queries. Unavailable search setup, including
an unreadable key file, logs an error and uses text-only recall while preserving
explicit tools. A configured reader without a publisher reports unverified
publication coverage as partial. Query preparation itself never runs or waits
for publication.

After the fit results pass two independent reviews, replace vector nomination
with engine candidate retrieval. Keep existing text/identifier recall and source
validation. Candidate retrieval must account for candidates rejected by
admission, grouping or revision checks, rather than assuming the first six
neighbors are six usable memories. Test against the existing exhaustive
selection and actual answers before choosing approximation settings.

Integrate one private persistent Qdrant service into Sen's existing lifecycle,
with explicit resource settings and health. Publish only after successful waited
updates; retry interrupted publication by stable ID. Existing stored vectors
seed the index. Preserve SQLite and the old binary's ability to read it; no
storage conversion or compatibility shim is authorized by this design.

Implement and review small Lace and Sen changes separately, update evergreen
docs, run focused checks and one full suite, merge in dependency order, then
deploy only to Reeve. Keep extraction off and subagent automatic recall off. An
index outage uses the explicit text-only fallback. Keep the former images and
SQLite snapshot for rollback. Widening deployment is outside this work.

## References

- https://qdrant.tech/documentation/manage-data/storage/
- https://qdrant.tech/documentation/manage-data/indexing/
- https://qdrant.tech/documentation/ops-optimization/optimizer/
- https://lancedb.github.io/lancedb/js/classes/Table/#optimize
- https://github.com/asg017/sqlite-vec/releases
