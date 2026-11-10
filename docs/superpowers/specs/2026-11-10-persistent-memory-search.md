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
