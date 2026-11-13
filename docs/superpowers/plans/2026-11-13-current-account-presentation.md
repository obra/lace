# Independent current-account presentation

Jesse approved private qualification and Reeve-only deployment on November 13.
Root owns this design. Land and deploy the newest-first slice before this
presentation change; private implementation may proceed while that slice
completes CI. Keep the fixed 2,000-token allowance, retrieval policy, source
authority, storage, revisions and ordinary verification.

## Small implementation

- Keep the identity of each nominated note through request-private ranking. Use
  a discriminated passage/note candidate rather than converting a note into an
  arbitrary supporting passage. Passage ordering and relevance scoring stay as
  they are; notes score their own text. A note does not require its support to
  have a projected passage.
- Factor the existing current-account support loading and synchronous validation
  into shared local reader helpers. Both original attachments and directly
  nominated accounts use those helpers. Required support must be current, or a
  readable pinned superseded document. Recheck authority, the expected head
  revision and support after awaited work. Do not create a new public tool or
  storage API; pass the private account resolver to automatic recall.
- A validated direct nomination becomes an evidence group with no original
  excerpt and exactly one current account: id, revision, model-authored
  attribution and validated source-read handles/statuses. Original-led groups
  retain all required current accounts. Do not merge the direct group back into
  every account attached to its supporting journal.
- The existing packer accepts either complete original-led groups or the
  single-account group. Preserve ranking and whole-account budgeting. Keep the
  first fitting group when a later group repeats one of its accounts, so the new
  representation does not spend the allowance twice on the same account. A
  skipped original is never displayed without its required correction context.
- Reused selections reload the expected current account; final synchronous
  checks reject changed heads, revoked authority and invalidated support for
  both forms. Never reuse a prior account's prose solely because its identifier
  still exists.
- Explain in the existing recall framing that a model-authored account may
  appear without its raw quotation. Source handles are available for a concrete
  missing fact or conflict, not a mandatory reread. Keep all other reader
  instructions unchanged.

## Qualification and landing

Use Sol implementation and two independent reviews. First capture failing
real-behavior regressions: a directly retrieved account fits while its
shared-journal attachment bundle does not; current revisions replace stale ones;
missing or mutated support and changed heads are omitted; original quotations
retain the existing correction guard; reuse and fixed allowance hold. Exercise
ordinary text fallback and semantic nomination through the same path. No new
index, schema, reranker, queue or configurable budget.

Reproduce the captured Reeve packing barrier privately, then use the existing
evaluator for one bounded fresh answer comparison (two fresh work requests,
prior versus new presentation, same sources/model/state). Include a corrected
account and a task whose needed historical fact is incidental. Grade delivered
work and unnecessary tool use, then interview each session once. Preserve failed
or empty outcomes, do not replace runs. Exact inputs and questions freeze before
inference. This does not reopen the completed three-arm comparison.

If the fix and answer qualification pass both reviews, merge, pin in Sen and
deploy only on Reeve through normal checks. Verify that a newly extracted
account reaches a later ordinary decision and that an actual correction changes
the subsequent decision. The primary-versus-reconciliation-support extraction
input omission remains a separate causal prompt change; do not silently include
it here.
