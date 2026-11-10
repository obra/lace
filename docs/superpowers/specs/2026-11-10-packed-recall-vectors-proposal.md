# Proposal: compact passage vectors in the existing memory database

Status: proposed by Bot; Jesse has not approved the storage transition.

## Problem and evidence

Fresh automatic recall scans every admitted passage and decodes its vector from
JSON before scoring. Reusing a selection skips that scan. In the preserved
populated Linux case, both detailed scans read 196,575 rows. Row decoding took
16.987 and 16.630 seconds; SQLite reads took 4.213 and 2.855 seconds, caller
processing 4.503 and 5.900 seconds, and cooperative waits 3.502 and 1.829
seconds. The decoding timer includes source-reference parsing and row
construction as well as vector parsing. A separate sampled profile attributed
11,462 of 11,692 `passageOf` self samples to its vector parsing/materialization
expression, versus 122 nested `sourceOf` self samples. This identifies the
expression, not pure JSON-parser time or a predicted speedup. The full
preparations took 40.573 and 34.437 seconds under amd64 emulation.

Reeve's live fresh preparations took 97.046 and 91.216 seconds. The first of
those followed catalog loads of 39 and 270 milliseconds. The laboratory phase
breakdown must not be presented as the breakdown of those live requests.

## Recommended change

Use packed little-endian 64-bit floating-point values for passage vectors in the
existing SQLite `memory_passages.vector` column. Preserve every JavaScript
numeric value, the encoder generation, source/version admission, exhaustive
candidate scan, accumulation order, ranking, and evidence validation. Keep
notes, originals and transcript references unchanged. Do not introduce another
store, service, model, approximate search, or an in-memory copy of the whole
index.

Read one existing bounded page at a time and expose its numeric values without
JSON parsing. New passage embeddings use the packed format. A malformed packed
value must not be silently treated as a valid vector.

Convert existing JSON vectors locally in bounded transactions, reusing the
stored numbers rather than re-embedding text. Visit every row by increasing
rowid in bounded pages, and select conversion work within that page; a `LIMIT`
on only eligible rows would not bound the search when most rows are already
converted. Guard each update with the source version and the value read. A
stopped conversion leaves valid old and new rows. The new reader accepts both
formats during transition. This is backward compatibility and needs Jesse's
approval.

Keep the conversion out of startup and ordinary maintenance. A small explicit
operator utility converts in either direction, with the colleague stopped. For
the pilot, preserve a fresh private backup, stop Reeve through the normal
maintenance path, convert the derived vectors, deploy the new reader, and
validate before declaring the pilot restored. All memories and transcript
references stay in the same database. No new persistent migration service,
automatic vacuum, or duplicate vector store is proposed.

Rollback must be tested before the first production packed write. The previous
reader cannot consume packed values under the same encoder generation, so an
image-only rollback is unsafe. Stop the colleague, run the same bounded utility
in the JSON direction on the current database, verify the old reader against it,
then use the stock deployment path. This preserves memories added after upgrade;
restoring an older database backup is not the ordinary rollback procedure.

## Alternatives and limits

- Keeping JSON and adjusting scheduling leaves the measured decoding cost.
  Maintenance can query for missing vectors before its encoder gate, but the
  measured yield intervals were smaller than decoding. That separate finding
  does not explain the full delay.
- A native vector-search backend could also remove JavaScript parsing and
  scoring, and an approximate index could avoid exhaustive scans. Either adds a
  dependency and a larger storage/search contract. It deserves a separate design
  and retrieval-quality evaluation if the smaller change is inadequate.
- Caching all decoded vectors would recreate the populated-index memory risk and
  is ruled out.

Packed storage still leaves work linear in the number of passages. This proposal
removes avoidable representation work; it does not establish years-of-history
latency or promise a particular response time. Its effect must be measured.

## Validation and rollout

First benchmark the packed read-and-score path on a private copy; do not assume
the profiling result guarantees an adequate improvement. Before accepting the
change, compare old and packed representations for exact numeric values, dot
products, ordered candidates and selected evidence, including ties and the
semantic threshold. Exercise mixed rows, interrupted conversion, current-source
checks and the stopped-owner requirement. Prove a round trip to JSON readable by
the actual previous binary, including a new vector created after the upgrade.
Verify no packed rows remain across any encoder generation before exercising a
fresh recall cue with that binary; reusing a selection would skip the vector
scan. Run the preserved populated case with concurrent native workers once the
focused regression is green, using the same model, queries and limits. Preserve
all prior runs and measure conversion downtime, peak disk and WAL use in both
directions, bounded memory and fresh/reused preparation separately.

Use a private copy for the conversion experiment before production migration.
Two independent Sol reviews cover the implementation and measured conclusions.
Merge Lace, pin it in Sen, and deploy only Reeve through the stock upgrade path.
Verify retained memory identity/session, actual completed Slack work, child
automatic recall off, extraction off, and healthy resource observations.

The diagnostic changes already prepared are separate from this unapproved
storage proposal. No packed vectors or migration have been implemented. Two
independent reviews found the rollback and work-discovery gaps in the initial
proposal; the explicit reversible conversion above is Bot's revised proposal.
