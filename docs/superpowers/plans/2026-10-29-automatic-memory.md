# Automatic memory implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically derive durable, attributed memories from retained inputs
and retrieve them through Lace's existing recall tool.

**Architecture:** One opt-in, root-owned worker discovers existing transcript
and Git document versions, invokes an independent model request and accepts
supported notes in the landed authority database. Existing journal/knowledge
writers remain intact. A later Sen integration supplies this configuration under
its existing boot lock; no new manual memory tools or source archive.

**Tech Stack:** Existing TypeScript, Zod, better-sqlite3, provider registry, Git
and Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-automatic-memory-design.md` (Jesse
selected derived memories via recall).

## Global Constraints

- No new foreground memory tools, source archive, source-payload copies, general
  scheduler, embeddings or automatic context insertion.
- Preserve journal/knowledge writers, existing transcript recall and ordinary
  unconfigured sessions.
- Use one existing authority database and host owner; check current binding and
  sources inside acceptance.
- Only root starts extraction; derive child bindings and persist session
  affinity, never grants.
- One single-flight worker: startup, append and 30-second maintenance wake; no
  overlapping inference.
- At most 16 primary sources, 16 candidates, 16 changes; 64 KiB source text, 4
  MiB image data, 64 KiB response, 16,384 output tokens, 4,096 characters per
  note.
- One format repair; no elapsed-time deadline for background models and no
  automatic terminal-failure retry loop.
- Read current committed document versions and incremental changes, not all
  historical Git versions. Originals stay in existing storage.
- Preserve frozen candidate/evaluation trees. No Docker, inference, production
  operations or network requests in local tests.
- Use Node24 from
  `/Users/jesse/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`;
  one heavy process and one test worker at a time. Save and read every test log.
  Never bypass hooks.
- Two independent Sol reviews of the actual feature diff. The controller owns
  PRs, full CI, publication and Sen integration.

## Review Focus

- Ordinary sessions and transcript recall must remain usable without memory
  configuration; Task 1 covers the unconfigured RPC and tool path.
- Root persona selection by a child must not grant extraction or mutation
  authority; Task 1 covers delegated initialization and current permissions.
- A final-turn document snapshot and child process writes must be discovered
  without another user turn; Task 1 exercises a held snapshot and maintenance
  wake.
- Partial/incomplete model output and a missing sidecar must not become
  successful processed coverage; Task 1 records the actual failure/omission and
  preserves unrelated work.
- Rebuilding the disposable recall index or restarting after acceptance must not
  duplicate extracted facts or lose current-note reads; Task 1 uses real
  retained events, Git and SQLite.

---

### Task 1: Configured automatic extraction and derived recall

**Files:**

- Create focused modules under `packages/agent/src/memory/`: `types.ts`,
  `notes.ts`, `sources.ts`, `extraction.ts`, `runtime.ts`; combine only where
  doing so remains clearer.
- Reuse `memory/authority.ts`; do not import the frozen candidate's
  `store.ts`/eligibility graph.
- Modify canonical schemas in
  `packages/ent-protocol/src/schemas/{shared,methods}.ts` and their exported
  inferred types.
- Modify `packages/agent/src/{server-types,server,main}.ts`,
  `rpc/handlers/{initialize,session,prompt}.ts`,
  `core/conversation/{types,runner}.ts`, `jobs/subagent-job.ts`,
  `storage/session-store.ts`, `conversation/slash-commands.ts`, `tools/types.ts`
  for trusted configuration, lifecycle, affinity and context.
- Modify `storage/event-log.ts` only for a small post-append wake hook if
  needed; reuse `storage/recall/{backfill,index-db,index-writer}.ts`
  discovery/repair contracts without redesigning them.
- Modify `conversation/one-shot-query.ts`, `tools/implementations/recall.ts`;
  fix existing `rpc/utils.ts` and `compaction/toolkit.ts` image MIME mappings
  only where exercised by this source path.
- Add focused tests under `memory/__tests__/`; extend existing one-shot,
  RPC/session, recall, sidecar and native-image test files as necessary for real
  contracts.
- Add `docs/architecture/automatic-memory.md`; update `docs/features/recall.md`,
  `docs/architecture/memory-authority.md` and CODE-MAP for shipped behavior.

**Interfaces:**

- Consumes: `openMemoryDatabase(path,instanceId,false)`, current authority
  assertions/child binding derivation, retained event/sidecar APIs, existing
  provider and tool contexts.
- Produces: optional
  `InitializeParams.memory = {databasePath,binding,extraction?:{connectionId,modelId},documentSources?:{gitRoot,paths}}`
  exactly as the spec.
- `createMemoryRuntime(configuration)` owns a connection and optional root
  worker; expose `wake()`, read-only note access for ToolContext and `close()`;
  internal helper signatures are implementer choices, not new public extension
  points.
- Existing `recall.search` gains a bounded `memories` result group. Each entry
  has `event_id: "memory:<id>"`, revision, preview and attribution; existing
  transcript results retain their shape and limits. `recall.read` recognizes
  that handle and reads the current note with its support/status. `thread` is
  unchanged.
- Model proposal is strict
  `{changes:[{text:string,sourceIds:string[],target?:{noteId:string,revision:number}}]}`.
  New note IDs/producer/work identities come from the runtime, not free model
  authority fields.
- Current accepted heads, immutable revision receipts, immutable offered work
  and current document heads share the authority database. Their exact SQL
  layout stays small and local to `notes.ts`.

- [ ] **Step 1: Add failing behavioral witnesses using real temp
      SQLite/events/Git.** Cover event+document → independent model proposal →
      accepted note → recall after restart; repeated same source/version yields
      no duplicate. Preserve transcript recall with no memory configuration. A
      valid empty changes array marks only offered input processed.
      Missing/oversize input and terminal/provider errors remain distinct from
      success.
- [ ] **Step 2: Run the new focused tests and save the expected RED output.**
      Use the local Vitest binary from `packages/agent`,
      `run --maxWorkers=1 --no-file-parallelism <exact new test paths>`, Node24
      and the existing offline guard at
      `.superpowers/sdd/2026-10-29-provider-request-correctness/network-guard.cjs`.
      Inspect the log; do not count a tooling/ABI error as a valid red test.
- [ ] **Step 3: Implement bounded source discovery and note/work acceptance.**
      Verify actual source content, pin Git identity once, track current
      document versions/deletions separately from processing, exclude recall
      results from primaries, keep exact offered IDs/revisions. Atomically write
      accepted heads/revisions/FTS and completed receipts with current authority
      checks. No copied source archive. A read checks the current source state
      and never silently substitutes a new version.
- [ ] **Step 4: Implement one root worker and the minimal one-shot extension.**
      Coalesce wakes and maintain a single inference promise. Keep discovery
      responsive/yielding; a held background call does not become a foreground
      turn or timeout from elapsed wait. Reject unfinished/tool-calling/oversize
      output; permit one bounded format repair. Shutdown fences the attempt
      before aborting/closing; restart can resume unfinished work but not
      duplicate accepted work.
- [ ] **Step 5: Wire trusted initialization, session affinity and child read
      access.** Validate before activation; missing/mismatched/stale authority
      rejects memory-bearing sessions. Cover new/load/fork/clear/persona
      changes. Child initialization forwards only a derived binding and path.
      Reads use current role authority; no binding stored in session
      config/model input. Worker cleanup runs before memory/recall connections
      close.
- [ ] **Step 6: Integrate current-note search/read into recall and preserve
      native content.** Keep original transcript shapes, caps and redaction.
      Read note heads directly; don't scan revision history. Add derived note
      results only when trusted memory context is available. Use native image
      blocks when supported; keep source unavailability/unsupported coverage
      explicit. Do not add a new read tool.
- [ ] **Step 7: Exercise the meaningful races and permissions
      deterministically.** Hold a fake model response while a document snapshot
      changes, a newer note revision is accepted, grants are revoked, or the
      owner/attempt is replaced; none may accept stale writes. Check final-turn
      Git changes and child-event discovery on a controlled maintenance wake,
      source removal, index rebuild, source omissions, no self-feed, child
      root-persona restrictions and missing-authority resume. Verify provider
      cleanup/limits/terminal metadata. No timing stress loops.
- [ ] **Step 8: Run the focused union once after final edits, then
      typecheck/lint/format.** Keep all output in this plan's evidence
      directory; read every result. Broaden tests only for concrete changed
      dependencies. Do not run network/container-dependent full suites locally;
      controller runs the repository's full CI after reviews.
- [ ] **Step 9: Update evergreen documentation and commit through normal
      hooks.** Document optional configuration, source coverage,
      derived-vs-original semantics, committed-file delay, failure/progress
      behavior and unproved model quality. Stage only named files. Commit
      coherent increments with intent and validation; report actual lines/files
      and any remaining concern.

## Sen continuation after Task 1

This plan owns the coherent Lace landing, not a claim of Sen enablement. The
controller then updates the paired isolated Sen checkout on current main: reuse
the existing boot lock, stable instance identity and one boot generation; pass
the exact memory configuration through initial admission and supervised restart;
use the existing balanced model tier; configure journal/knowledge paths under
the service-visible instance Git root. Default opt-in remains off until explicit
configuration. Keep the current snapshotter and all manual tools unchanged. That
concrete Sen patch receives its own focused tests and two independent reviews.
No new extraction RPC or snapshotter handshake is needed: the root worker's
maintenance wake observes committed changes.
