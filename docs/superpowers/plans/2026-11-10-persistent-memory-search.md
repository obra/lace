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
- Qualification starts with Float32/Dot, m=16, ef_construct=100, hnsw_ef=128,
  100 candidates, one optimizer job/indexing thread; cold vectors/cached graph.
  The measured runtime decision uses exact search and bounded pagination.
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

- [x] Create one state row for generation/incarnation, passage/note cursors and
      seed completion; create a pending table with autoincrement sequence and
      unique serialized point identity. Use real SQLite triggers to enqueue
      current writers atomically. Explicitly capture the old identity before
      `INSERT OR REPLACE`; refresh sequence on every same-identity enqueue.
- [x] Seed already-stored matching-generation passages and current note vectors
      in pages of 128. Save cursor and enqueued page in one transaction. Drain
      pending pages between seed pages, so no all-corpus memory map or queue
      construction is needed. An unchanged completed state never reseeds.
- [x] Resolve current authoritative vectors for a pending page only. Missing,
      invalidated or wrong-generation entries delete that point. Complete both
      upsert and delete operations before removing only the acknowledged
      sequence numbers. Fence ownership/cancellation before every outbound
      mutation and within local acknowledgment. Pass a beforeCreate guard to
      ensure so ownership is checked after the awaited collection lookup;
      upsert/delete pages are at most 128 points and need no multi-batch gap.
- [x] Clear in-process readiness before ensure; after a new incarnation reset
      seed progress in the same transaction that binds it. Failures retain work
      and partial status. Current-DB restart resumes; restored-DB deployment
      will recreate the derived collection as specified in the restore rule.
- [x] Test real SQLite plus the real HTTP client at a controlled local server:
      initial seed/reopen, write after seed, revision invalidation, actual
      REPLACE clearing/changing a passage, same-identity change during a held
      write, remote success before a lost acknowledgment, abort/owner rotation,
      and collection recreation. Inspect effects and preserved pending work.
- [x] Run focused tests and relevant typecheck/lint/format checks, save
      receipts, self-review and commit owned files. Obtain two independent code
      reviews.

### Task 5: Add bounded candidate lookup and score operations

**Files:** `packages/agent/src/memory/search-index.ts`, `passages.ts`,
`recall-scratch.ts` and their focused tests. Do not change automatic nomination,
runtime wiring, protocol configuration or Sen in this task.

**Contract:** Extend `query(vector, limit, signal, options?)` with internal
`{offset?, minScore?}` options. Add `scores(vector, identities, signal)` for at
most 1,024 explicit identities using an exact point-ID-filtered query, with no
floor. Neither method returns vectors or creates a collection. Add passage
point/source-prefix lookups that never select the JSON vector column. Return the
passage rowid, generation and vector-presence metadata needed to reject stale
engine hits and preserve nomination order. Source-prefix reads are paged by
rowid with an optional version (event FTS matches all admitted versions).

- [x] Validate offset, finite threshold, and bounded page/identity limits.
      Validate each scored result belongs to the requested identity set, reject
      unexpected/duplicate IDs, and preserve existing collection/error checks.
- [x] Add real SQLite passage-key lookup and source-prefix paging. Check the
      complete passage identity including end; join admitted sources. Exercise
      replacement, missing sources, generation changes and bounded pages without
      decoding vector content. Current note lookup and note-vector existence can
      use the existing note key; no new storage or index is required here.
- [x] Extend request-private scratch with bounded iteration of existing FTS
      match identities, a dedupe set of nominated point identities, and a way to
      clear ranking/dedupe after a semantic failure while retaining text
      matches. Keep aliases and existing comparison semantics intact. No new
      durable table, in-memory all-corpus set, or general search abstraction.
- [x] Test real local HTTP structured requests and effects for pagination,
      below-floor explicit scoring, absent points, foreign returned IDs,
      cancellation and failure. Run focused tests, package typecheck and scoped
      lint/format serially with preserved logs, then commit only owned files.

### Task 6: Wire persistent search into automatic recall

**Files:** `packages/agent/src/memory/automatic.ts`, `runtime.ts`, a narrow
current-note metadata accessor in `notes.ts` if needed, `search-publication.ts`
only for its concrete client dependency type, protocol memory schema and tests,
automatic/runtime regression fixtures and tests, and
`docs/architecture/automatic-memory.md`. Task 5 query helpers are prerequisites.

**Contract:** Production automatic recall uses `MemorySearchIndex` for all
semantic scores and existing SQLite FTS for text admission. The source,
current-account, quotation, grouping and packing contracts are unchanged.
`recall.search` is optional trusted host configuration, `{url, apiKeyFile?}`. An
absent or failed engine gives explicit text-only fallback. No former local
vector scan remains as a runtime fallback. Small deterministic test fixtures may
inject the public-method shape of the concrete search client through the
existing internal runtime dependencies; this is not a product backend API.

- [ ] Replace fresh nomination with paged engine hits through the semantic
      floor, then remaining FTS-hit passage/note identities and explicit bounded
      score calls. Hydrate by key without vector JSON. Reject stale generation,
      passage end, absent vector and note-revision hits. Compute both route
      flags before dedupe, retain the exact-identifier rule, and preserve
      passage rowid order with note rowids after passages for otherwise equal
      ranks. Advance native offset by raw returned count. No fixed total
      candidate cap. Re-resolve complete identities after each awaited
      explicit-score batch.
- [ ] Missing engine points stay eligible for textual admission, score -1 and
      partial coverage when a local matching-generation vector exists. Any
      actual semantic error clears partial ranking and nominated identities,
      then reruns text-only nomination with existing overlap scores and a
      visible reason. Abort/authority errors still propagate. Preserve same-cue
      reuse and source revalidation without repeated semantic queries.
- [ ] Construct the client from trusted configuration and root publisher after
      passage initialization. Start/coalesce publication independently of model
      loading and local discovery on each existing wake, and drain newly queued
      work after vector/projection work settles. Failure keeps pending work and
      logs a bounded diagnostic. Closing aborts publication/search before SQLite
      closes. Non-root and read-only bindings never publish or create indexes.
      Wait for initial publication and local work to settle before the final
      drain. Combine turn/runtime query abort signals; failed client setup
      leaves explicit tools and text-only recall available.
- [ ] Track publication start/settlement with one in-process epoch. Recall
      compares the epoch and pending status before/after the whole operation;
      publication overlap makes coverage partial without retries or waiting.
      Keep child automatic recall disabled and explicit tools unchanged. Sample
      final coverage before rendering the model-visible block.
- [ ] Retain the meaningful existing automatic-recall regression suite using a
      small deterministic search fixture. Add cases for a semantic-only
      paraphrase, below-floor text ordering, identifier priority, note identity,
      more than one native page with rejected hits, same-cue revalidation,
      engine absence/failure after a completed page, and publisher activity
      during pagination. Prove no request reads vector JSON by using candidate
      SQLite rows whose vector content cannot be decoded with engine scores
      supplied independently. Exercise actual runtime wake/close with a local
      HTTP fixture for publisher independence and cancellation.
- [ ] Update the evergreen architecture example and operational semantics. Run
      focused protocol and agent tests, typecheck, lint and formatting serially
      with saved logs. Self-review and commit owned files. Two independent
      implementation reviews precede populated integration tests.

### Task 7: Integrate Sen's private search service

**Files:** Sen `docker-compose.yml`, `docker/memory-search/`,
`src/instance/memory-runtime.ts`, `src/cli/up/stack-env.ts`, the existing Garden
profile reset and coworker upgrade helper, focused behavioral tests, and
evergreen automatic-memory, filesystem and deployment references. Root owns the
final `.lace-ref` update after Lace merges. No production operations in this
implementation task.

**Contract:** Follow the Sen service section of the spec. A native Compose
profile controls one private pinned Qdrant service with a persistent volume,
explicit resource limits and health. Existing startup paths consume the same
persisted profile. A small shared upgrade helper converges that service after
namespace replacement. Search failure leaves core and text-only recall usable.

- [ ] Add the optional `memory-search` profile/service, pinned image,
      loopback-only configuration, Linux named volume, resource limits and Bash
      readiness probe. Core's optional dependency uses `service_started` and
      `required: false`. Reuse the proxy namespace and publish no port.
- [ ] Supply the fixed search URL only with root recall configuration; keep
      child configuration and explicit memory tools unchanged. Scrub inherited
      `COMPOSE_PROFILES` in local stack and Garden profile handling without
      adding another environment parser.
- [ ] Resolve active services and converge only this instance's search container
      in ordinary and Garden upgrades after final proxy/core replacement.
      Preserve the named volume. Reuse a small helper with the existing Compose
      callback and health waiter; no general service registry or receipt-schema
      rewrite.
- [ ] Exercise real behavior with deterministic tests: profile-off/on resolved
      services, resource/network configuration, root initialization data,
      environment isolation, HTTP readiness success/failure, and the shared
      upgrade helper executed against fake commands. Do not assert large
      rendered shell strings. Preserve saved failing/passing logs and coordinate
      the single heavy-test slot with Lace work.
- [ ] Update evergreen documentation for enablement, explicit text-only
      fallback, data ownership and volume-preserving upgrades/restore. Run
      focused checks plus required doc-drift/docs tests and relevant typecheck,
      lint and formatting serially. Self-review and commit owned files; two
      independent reviews follow. Root adds the real merged Lace pin later.

### Subsequent delivery stages

The agreed sequence is incremental publication and query integration in Lace;
private service lifecycle/pin in Sen; full-preparation and answer validation;
two independent final reviews; dependency-ordered merges; Reeve-only deployment
and operational observation. Concrete task interfaces follow the fit test so the
plan does not prescribe untested storage assumptions. A failed fit result is
preserved and diagnosed before changing tools or settings.
