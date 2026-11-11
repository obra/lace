# Bound text nominations before passage scoring

Jesse requested that we keep Qdrant, repair excessive retrieval work, preserve
the runs, and test latency and delivered answers before deploying to Reeve.
Bot owns this design. The baseline is Lace `5504c2f`.

## Cause and scope

Two saved fresh recalls expanded roughly 60,000 text-source matches into
94,664 and 113,468 ranked candidates, issuing 740 and 887 explicit-score
requests. Each made only one semantic search page. The text path materializes
every match of an OR query before expanding passages, scoring, sorting, and
validating them. Batching bounds memory but does not bound this work.

Keep the persistent vector index, embedding model, semantic floor, ranking
within the nominated union, source/revision authority, evidence grouping,
2,000-token allowance, ordinary verification, and text-only failure behavior.
No storage migration, new service, public setting, or model turn limit.

## Selection rule

For each existing FTS surface (transcript events, original text, note heads):

1. Select up to 128 distinct admitted source identities in ascending SQLite
   FTS5 BM25 rank, with rowid as the stable tie breaker, using the existing
   safely quoted ordinary OR query.
2. Independently select up to 128 using an OR of safely quoted complete
   identifiers already recognized by `queryIdentifiers`. Do not split each
   identifier into an OR of its component words. Skip this route if empty.
3. Union those identities in the existing request-private match table, then
   use the existing passage expansion, scoring, validation, and packing.

An original identity includes its stored version; an event identity may expand
its admitted versions as before. Duplicate and orphan FTS rows do not consume
the distinct admitted budget. Page through matches to refill that budget.
Use existing SQLite existence checks; do not load vectors or whole source
texts just to nominate. Notes must have a current head. Events/originals must
have an admitted source and at least one passage. Extraction status is not
source authority. Final currentness and exact-identifier checks remain where
they are; FTS tokenization alone cannot establish an exact identifier match.

The 128-source policy is separate from transport/page sizing. It is a generous
initial shortlist, not a fitted optimum. It bounds nominated sources, not the
number of passages in one unusually large source. Do not add another passage
cap or rewrite sorting as part of this repair.

This changes selection: it does not preserve exhaustive text rankings. The
semantic route can still discover evidence outside the text shortlist. A
separate identifier route protects exact references from ordinary-word
competition, but neither route promises all matching evidence.

## Qualification

- Real SQLite tests must exceed the ordinary nomination budget, prove bounded
  expansion/scoring, and retain a useful exact identifier below that cutoff.
  Include duplicate/orphan refill, text-only fallback, below-floor ordering,
  and the existing current-revision checks. Test behavior, not rendered SQL.
- Use the existing populated-index/native-worker evaluator, persistent search
  on both sides, serial runs and identical input copies. Wait for publication;
  report startup separately from fresh retrieval and reused context. Preserve
  every failed and completed cell. A small optional natural-language query
  input may be added to this evaluator; do not build another harness.
- Use the existing answer evaluator with fresh sealed questions and identical
  source/retained-memory state, model and normal runtime settings. The existing
  19-passage fixture alone cannot test a 128-source cutoff: establish a larger
  supported fixture or explicitly withhold that qualification. Grade delivered
  answers, read transcripts, and interview private copies of completed cells.
- Two independent Sol reviews must examine the meaningful code change and
  conclusions. No material correctness/answer regression or resource failure
  may be explained away by lower latency. Qualify before Reeve deployment.

Production remains on its current pilot during this work; no other colleague
is enabled. Private source material stays outside the repository.
