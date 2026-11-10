# Persistent Memory Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.
> The coordinator owns architecture; Sol agents implement and independently
> review.

**Goal:** Qualify persistent Qdrant search on existing populated memory, then
replace the application-wide vector scan and deploy the reviewed change to
Reeve.

**Architecture:** SQLite owns memory authority and provenance. Qdrant is a
private rebuildable search index; Lace retains the existing embedding model and
retrieval policy.

**Tech Stack:** Node 22, TypeScript, better-sqlite3, Qdrant Server 1.20.0,
existing local Gemma encoder.

**Spec:** `docs/superpowers/specs/2026-11-10-persistent-memory-search.md`

## Global Constraints

- Preserve immutable inputs and all runs; private corpus data never enters Git.
- Root-only automatic recall, explicit memory tools preserved, Reeve-only pilot,
  extraction off.
- No new turn/time limit, corpus re-embedding, storage conversion, service fleet
  or multi-backend framework.
- One heavy test at a time. Record test output and inspect it before further
  action.
- Start with Float32/Dot, m=16, ef_construct=100, hnsw_ef=128, 100 candidates,
  one optimizer job/indexing thread; cold vectors/cached graph.
- Two independent reviews of implementation and experiment conclusions.
- Jesse's execution approval covers the described staged implementation; no
  routine reapproval between stages.

## Review Focus

- A populated baseline must be opened read-only and remain byte-identical.
- Recent or revised points must be visible before background index optimization
  finishes.
- Replayed publication and restart must preserve IDs and deletion behavior.
- Numerical ties and stale candidate rejection must not be mistaken for semantic
  loss or perfect equivalence.
- Server working memory and full recall preparation must be measured separately
  from a vector-query microbenchmark.

---

### Task 1: Add a reproducible private index qualification command

**Files:** Create `scripts/benchmark-memory-search.ts`,
`scripts/lib/memory-search-benchmark.ts`, and
`packages/agent/src/memory/__tests__/search-benchmark.test.ts`. Document command
usage in `docs/development/memory-search-benchmark.md` (create directory if
needed).

**Interfaces:** A CLI accepts explicit SQLite snapshot, query-panel JSON, model
directory, loopback Qdrant URL, unique collection and fresh output directory.
The query panel contains `{queries: [{id, text}]}`. Prepared output retains
query vectors, generation, dataset digest, point counts and exact reference
IDs/scores privately. Commands `prepare`, `import`, `query` and `mutations`
operate on saved outputs; the root owns Docker lifecycle. Qdrant calls use
built-in fetch; no product API or runtime wiring yet.

- [x] Write behavioral tests for stable point identity (source
      ID/version/start/end/generation), finite 768-dimensional input validation,
      streamed bounded top-100 exact reference, tie-aware comparison, and
      refusal to replace existing output or a mismatched/nonempty target
      collection. Use a tiny temporary SQLite DB and a real local HTTP test
      server where useful; assert effects and structured contracts, not rendered
      large strings.
- [x] Run that test file once and preserve the failing output.
- [x] Implement the CLI and helper. Read SQLite with readonly/fileMustExist, set
      query_only, iterate bounded row batches from the same
      passages/source-version join as `MemoryPassages.pages`, and include only
      the selected encoder generation. Parse corpus vectors only during
      prepare/import. Encode queries using the existing local encoder. Use
      deterministic UUID-shaped IDs derived from the complete passage identity;
      preserve an ID mapping privately. Keep top-100 references per query
      without retaining the corpus. No private text in routine stdout.
- [x] Implement Qdrant collection creation and sequential bounded upsert batches
      with wait=true; metadata includes source identity/version/generation.
      Refuse foreign collection reuse. Query exact then HNSW on saved query
      vectors and save raw IDs/scores/times; report ties and overlap without
      declaring answer-quality success. Mutations use dedicated sentinel points
      with known vectors and exercise visible upsert/revision/delete/idempotent
      replay without changing imported corpus points.
- [x] Keep commands restartable through explicit saved artifacts and fail on
      errors rather than relaunching. Save each command's outputs under a fresh
      run subdirectory, never overwrite previous results. Include concise usage
      and measurement limitations.
- [x] Run the focused tests, typecheck/lint the touched code as applicable,
      inspect logs, format, self-review and commit only owned files.

Review refinements for Task 1: Qdrant commands accept `--api-key-file` without
logging it. The snapshot is a sealed standalone backup without WAL/SHM siblings,
hashed before/after reads. Query accepts the snapshot for independent boundary
score checks. Save details_level=4 telemetry and collection state; label
HNSW-enabled until counters demonstrate graph search. Waited writes require
`status=completed`. Mutation verification is separately read-only after
container recreation: new revision ID present, old/deleted IDs absent by exact
lookup. Root owns cgroup peak/events/CPU and swap receipts.

### Task 2: Execute and review the populated fit test

**Files:** Private artifacts under the existing incident evidence directory;
public aggregate report beside the benchmark documentation. No private data
committed.

**Interfaces:** Consumes Task 1 commands and the frozen snapshot/query panel.
Produces engine fit evidence, exact/ANN comparisons and recovery receipts for
the next implementation stage.

- [x] Pin the server image digest, freeze query panel and inputs, verify host
      capacity and create one uniquely named isolated resource set. Keep port
      private and record it.
- [x] Prepare and import once, recording preparation/import/indexing times and
      resource peaks separately. Do not duplicate an active import.
- [x] Run first/repeated exact and HNSW queries, then mutation/replay and
      owned-server restart checks. Preserve all outputs, database identity and
      input hashes. A service restart is not an OS-page-cache cold test; label
      it accurately.
- [x] Obtain two independent Sol reviews of the code and interpretation. Resolve
      reachable findings with minimal changes and targeted verification.
- [x] Record the measured decision. If the engine is suitable, the coordinator
      writes the concrete runtime-integration task interfaces using these
      results and proceeds under Jesse's existing authorization. Do not invent
      production APIs before this evidence exists.

### Task 3: Add the internal persistent-search client

**Files:** Create `packages/agent/src/memory/search-index.ts` and
`packages/agent/src/memory/__tests__/search-index.test.ts`. Update the existing
memory architecture reference only when runtime wiring lands; this client is not
yet active. Do not edit the benchmark or introduce a backend framework.

**Contract:** `MemorySearchIndex` receives `{url, apiKeyFile?}` and
`{instanceId, generation}`. Export typed passage and note identities, points and
hits. `ensure(signal)` validates or creates the owned collection and returns its
incarnation. `upsert(points, signal)` and `remove(identities, signal)` send
bounded waited writes, accepting only completed results.
`query(vector, limit, signal)` uses exact Dot search and returns
identities/scores. No query creates a collection. No class method silently
retries a failed operation. The publisher, not this client, will own SQLite
state.

- [x] Use deterministic UUIDs over kind, identity and generation; preserve the
      passage identity definition used in qualification. Notes include revision.
- [x] Use the measured Float32/Dot and storage/index configuration. Validate
      existing owner/generation/format metadata and relevant collection
      settings; preserve foreign collections. Collection recreation gets a new
      incarnation.
- [x] Permit literal loopback HTTP(S) URLs only, refuse redirects, read an
      optional private key without logging it, and propagate cancellation. Keep
      HTTP failure diagnostics bounded and free of the configured key.
- [x] Test with a real local HTTP fixture: first create/reopen, foreign identity
      refusal, exact query and validated response, completed versus ambiguous
      writes, deletion, cancellation, and error redaction. Exercise structured
      requests/effects rather than rendered shell strings.
- [x] Run the focused test file and relevant typecheck/lint/format checks with
      saved logs. Self-review and commit only owned files. Two independent
      reviews follow before publication wiring.

### Task 4: Add durable incremental publication

**Files:** Create `packages/agent/src/memory/search-publication.ts` and
`packages/agent/src/memory/__tests__/search-publication.test.ts`. Do not wire
runtime or change retrieval in this task. Reuse Task 3's client; extend its
ensure method with a required beforeCreate guard and update its focused test.

**Contract:** `MemorySearchPublication(notes, index, binding, generation)`
initializes only after verifying root mutation authority in the SQLite
transaction. `run(signal)` serializes the existing publisher lifetime, ensures
the collection, binds its incarnation, seeds metadata and drains bounded pages.
`partial()` reports unverified incarnation, unfinished seed or pending work. No
timers, embeddings, source rewriting, new storage format or automatic retry.

- [ ] Create one state row for generation/incarnation, passage/note cursors and
      seed completion; create a pending table with autoincrement sequence and
      unique serialized point identity. Use real SQLite triggers to enqueue
      current writers atomically. Explicitly capture the old identity before
      `INSERT OR REPLACE`; refresh sequence on every same-identity enqueue.
- [ ] Seed already-stored matching-generation passages and current note vectors
      in pages of 128. Save cursor and enqueued page in one transaction. Drain
      pending pages between seed pages, so no all-corpus memory map or queue
      construction is needed. An unchanged completed state never reseeds.
- [ ] Resolve current authoritative vectors for a pending page only. Missing,
      invalidated or wrong-generation entries delete that point. Complete both
      upsert and delete operations before removing only the acknowledged
      sequence numbers. Fence ownership/cancellation before every outbound
      mutation and within local acknowledgment. Pass a beforeCreate guard to
      ensure so ownership is checked after the awaited collection lookup;
      upsert/delete pages are at most 128 points and need no multi-batch gap.
- [ ] Clear in-process readiness before ensure; after a new incarnation reset
      seed progress in the same transaction that binds it. Failures retain work
      and partial status. Current-DB restart resumes; restored-DB deployment
      will recreate the derived collection as specified in the restore rule.
- [ ] Test real SQLite plus the real HTTP client at a controlled local server:
      initial seed/reopen, write after seed, revision invalidation, actual
      REPLACE clearing/changing a passage, same-identity change during a held
      write, remote success before a lost acknowledgment, abort/owner rotation,
      and collection recreation. Inspect effects and preserved pending work.
- [ ] Run focused tests and relevant typecheck/lint/format checks, save
      receipts, self-review and commit owned files. Obtain two independent code
      reviews.

### Subsequent delivery stages

The agreed sequence is incremental publication and query integration in Lace;
private service lifecycle/pin in Sen; full-preparation and answer validation;
two independent final reviews; dependency-ordered merges; Reeve-only deployment
and operational observation. Concrete task interfaces follow the fit test so the
plan does not prescribe untested storage assumptions. A failed fit result is
preserved and diagnosed before changing tools or settings.
