# Incremental Transcript Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development. Steps use checkbox syntax for
> tracking.

**Goal:** Avoid rereading successfully indexed transcript content on every
startup.

**Architecture:** Store per-file contiguous progress in the existing SQLite
index and commit it with catch-up writes. Keep existing transcript writers,
FTS/journal semantics, layouts and the full index-rebuild recovery path.

**Tech Stack:** TypeScript, Node file APIs, better-sqlite3, Vitest.

**Spec:**
`docs/superpowers/specs/2026-11-10-incremental-transcript-catchup-design.md`

## Global Constraints

- JSONL remains authoritative. No sequence watermark or live-writer checkpoint.
- Preserve independent FTS and journal gap recovery and valid unterminated EOF.
- FTS remains version 3; checkpoint reset accompanies an actual FTS rebuild.
- No production mutation or Ada deployment; preserve every existing run.
- One heavy process at a time; save test output; normal git hooks remain
  enabled.
- Root owns architecture; Sol implements and two independent Sol agents review.

## Review Focus

Required tests below cover the key hazards: a journal gap behind successful FTS,
an FTS gap behind a later event, a partial UTF-8/EOF record, stale progress read
before a sibling commits, and rebuilding an index with saved progress.

### Task 1: Persist and use contiguous file progress

**Files:**

- Modify `packages/agent/src/storage/recall/backfill.ts`.
- Modify `packages/agent/src/storage/recall/index-db.ts`.
- Create `packages/agent/src/storage/recall/transcript-checkpoints.ts` only for
  the table/checkpoint operations and bounded byte reader that keep backfill
  readable; avoid changing the unrelated live injection reader.
- Test `packages/agent/src/storage/recall/__tests__/backfill.test.ts`,
  `event-journal.test.ts`, and `index-db.test.ts`; a focused checkpoint test
  file is appropriate if reader cases would obscure backfill tests.
- Update `docs/features/recall.md` to describe shipped catch-up/rebuild
  behavior.

**Interfaces:** Keep `backfillIndex(db, laceDir): BackfillStats` and existing
callers. Internal checkpoint helpers use paths, opened-file metadata and raw
byte positions; no new public configuration.

- [ ] Add failing regressions using real files/SQLite: unchanged second pass
      reads no transcript bytes and succeeds with a sibling writer lock;
      appending one event scans only that suffix; independent journal/FTS
      failures prevent checkpoint advance past the gap while later events
      survive; transaction rollback preserves prior progress; UTF-8 across a 64
      KiB reader chunk and unterminated valid/torn EOF preserve exact journal
      text; replacement and shortening replay; new fork/mixed shards import;
      rebuild resets progress. Reuse existing deterministic lock interleaving
      fixtures instead of sleeps.
- [ ] Run the new focused tests under Node 22 and preserve the expected
      failures.
- [ ] Implement the spec using a 64 KiB read buffer and exact byte offsets.
      Recheck checkpoint state inside the existing immediate transaction. Avoid
      a per-session identifier query or write lock for fully unchanged files.
      Existing checkpoint absence uses normal catch-up; do not add a migration
      framework.
- [ ] Run the focused recall storage files and meaningful event-log/fork tests
      once; inspect every failure. Update evergreen docs, format touched files
      and commit with normal hooks. Report code, tests and any remaining
      concerns.

### Task 2: Qualify and land independently

- [ ] Root obtains two independent reviews of Task 1 and resolves reachable
      findings through the implementer.
- [ ] Build once, run the existing private populated backfill tool on a fresh
      candidate copy, then unchanged and appended-tail cases; compare retained
      FTS/journal contents. Preserve failed attempts and exact runtime commit.
- [ ] Run the full suite once in the isolated Linux environment, then hosted CI.
      Keep the original Mac failures separate and accurately reported.
- [ ] Land the indexed-identifier PR first, then this follow-up PR. Confirm the
      actual main commits. Do not equate merge with colleague deployment.
