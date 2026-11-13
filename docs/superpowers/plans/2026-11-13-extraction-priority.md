# Newest-discovered-first extraction implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the
> scoped implementation and two independent Sol reviews. Preserve qualification
> evidence in the existing delivery record.

**Goal:** Give newly discovered sources a chance in the next extraction batch
without changing storage, model, budgets or fact chronology.

**Architecture:** Reverse the existing pending-source selector. The running
batch is not interrupted; the same worker continues older pending work when
arrivals quiet down. Discovery order does not determine which fact is current.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, existing native extraction
evaluator.

**Spec:** Jesse approved on November 13: qualify newest-first privately, deploy
only to Reeve if it passes, then work through the remaining recommendations. The
approved selector is `MemoryNotes.pending()` in descending SQLite rowid order,
at the existing limit of 128. Sustained arrivals may postpone historical work.
No onboarding deadline or fairness guarantee is added.

## Global constraints

- Root owns architecture; Sol implements and independently reviews.
- Change only source selection order. Keep stores, receipts, source validation,
  model, batch limits, worker count and failure handling.
- Do not treat ingestion order as fact time. Older evidence processed later must
  not undo a newer applicable fact or create a competing stale account.
- Preserve every failed run, accepted note and revision. No production queue
  reset or manually accepted notes.
- Reeve is the only deployment target; deploy only after code and private native
  qualification pass two reviews.
- One heavy process at a time. Save test output and inspect it before acting. No
  repeated full-suite runs without a new cause.
- Use the existing evaluator and existing delivery progress record. Do not
  repeat the closed three-arm comparison.

## Review focus

Bounded newest selection; exclusion of already handled sources; continuation
into older pending work; restart retention; source dates governing corrections
despite reverse ingestion.

### Task 1: Reverse pending selection without changing its contract

**Files:** `packages/agent/src/memory/notes.ts`, focused tests under
`packages/agent/src/memory/__tests__/`, and
`docs/architecture/automatic-memory.md`.

**Interface:** `MemoryNotes.pending(): Source[]` remains unchanged. It returns
at most 128 pending sources, newest discovery first. All other methods and
tables retain their contracts.

- [ ] Add a real SQLite regression with more than 128 pending rows: first result
      is the newest inserted row, last is the 128th newest, and already handled
      rows are absent. Capture its expected failure before the fix.
- [ ] Verify that marking a returned batch handled leaves older pending rows
      eligible and that a newly inserted row becomes first on the next call.
      Close/reopen the store and verify the same ordering and retained statuses.
- [ ] Change only `ORDER BY rowid` to descending order in the pending selector.
      Adjust existing tests only where they depended incidentally on discovery
      order; retain their actual behavior assertions.
- [ ] Explain the ordering and sustained-arrival tradeoff in the evergreen
      architecture page.
- [ ] Run the focused changed tests; preserve red/green output. Root schedules
      the final relevant suite/typecheck once implementation is stable.
- [ ] Commit the implementation and report exact validation and remaining
      concerns. No pushes or deployment by the implementer.

### Task 2: Qualify fact chronology through native extraction

**Files:** Private fresh fixtures and results under the existing delivery
directory; no production writes.

**Interface:** Use `qualify-memory-extraction` against the exact built candidate
and real Sonnet 5.5. Separate wakes retain accepted notes/revisions and original
references.

- [ ] Freeze fresh departure, reassignment, change-of-mind and intention
      histories, with later applicable evidence discovered first and older
      originals introduced in a subsequent wake. Include a later actual
      correction of an existing account.
- [ ] Use the native worker to accept changes. Inspect offered candidates,
      accepted heads/revisions and source references; neither arrival order nor
      an older source may create a competing current account. Failed/empty
      proposals remain outcomes.
- [ ] Verify the selector against an isolated populated private copy without
      invoking its whole historical backlog. Check actual source order, bounded
      read and retained status/receipt state.
- [ ] Obtain two independent reviews of code and experimental conclusions.
      Address concrete causes only; a failed qualification blocks deployment and
      remains preserved.
- [ ] If qualified, merge through normal checks, pin the exact Lace revision in
      Sen, deploy with the existing guarded Reeve procedure, and verify
      effective flags, extraction/publication progress and outward delivery.
      Retain previous images and all data.

Account presentation and primary-versus-support prompt clarity remain separate
changes. Approval for them persists; their implementation follows this
qualification and its causal findings rather than being hidden inside the
ordering diff.
