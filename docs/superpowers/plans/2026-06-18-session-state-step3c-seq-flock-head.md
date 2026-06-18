# Session-State Step 3.3 — Cross-Process Seq Authority (flock + head file) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**THIS IS THE LOG-CORRUPTION-CRITICAL STEP.** Read the design first:
`docs/design/2026-06-18-session-state-step3-index-and-seq-authority.md` (rev2). A mistake
here corrupts the durable event log. Every task ends green; the seq-cutover task carries
real two-subprocess concurrency and crash-injection tests, and the whole change is
re-reviewed before it deploys to a live coworker.

**Goal:** Replace the per-append full-log scan (`deriveNextEventSeqAcrossSessionFiles`)
that assigns `eventSeq` with an **O(1)** read of a per-session **monotonic head file**,
guarded by a per-session **cross-process file lock**, using **reserve-before-append** so
a crash burns a harmless gap rather than a duplicate seq.

**Architecture:** A sync `mkdir`+owner-token cross-process lock (`session-lock.ts`). A
per-session head file `<sessionDir>/.seq` holding the next-free seq (`seq-head.ts`).
`appendDurableEvent` does, under the lock: read/seed the head `H`, write head `H+1`
(reserve), append the JSONL line with `seq=H`. The head reconciles to
`MAX(stored, MAX(JSONL)+1)` on open. `SessionState.nextEventSeq` is retired as an
authority. Wrapping the lock inside `appendDurableEvent` covers all ~20 callers; the only
non-`appendDurableEvent` writer is `session/fork` (a new session, no race — lazy seed).

**Tech Stack:** TypeScript, vitest, `node:fs`, `node:child_process` (real subprocess
concurrency tests). Per the codebase: real files in tests (tempdir), never mocked.

---

## Background (verified facts)

- `appendDurableEvent(sessionDir, state, event)` (`packages/agent/src/storage/event-log.ts:~434`)
  is **synchronous**. ~20 call sites all go through it (prompt.ts, permissions.ts,
  session-operations.ts, session.ts, subagent-job.ts, job-notifications.ts,
  inject-notification.ts, runner.ts, server.ts, repairOrphanTurnStarts). Keep it sync.
- Today it assigns `eventSeq = deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId)`
  (`event-log.ts:~472`), a full O(events) scan over legacy + all persona/date shards,
  **outside any cross-process lock**. Returns `nextState.nextEventSeq = written.eventSeq+1`.
- `session/fork` (`session.ts:941`) copies events with raw `appendFileSync`, preserving
  seqs — bypasses `appendDurableEvent`. (Safe: new session, no concurrent appender.)
- `loadSession` (`session-store.ts:~284`) repairs `state.nextEventSeq` from
  `deriveNextEventSeqFromEventLog` (= `MAX(JSONL)+1`) and rewrites state on mismatch.
- Consumers are **gap-tolerant** (verified by the design review): the reducer sorts by
  seq; watermarks compare `>`/`<=`; checkpoints match exact stored seqs; recall ranges
  tolerate missing neighbors. Nothing assumes gapless seqs **except** the `loadSession`
  repair, which this plan retires.

**Invariants (from the design — do not violate):**
- Reserve-before-append: write head `H+1` BEFORE appending JSONL `seq=H`. A crash in
  between burns `H` (a gap). Never a duplicate.
- Reconcile monotonic: `head = MAX(readHead()|0, MAX(JSONL)+1)` on open — never moves down.
- The lock is held across the JSONL append (so seeding reads a stable `MAX(JSONL)`).
- Gaps are allowed; seq is unique + monotonic.

**Test command:** `cd packages/agent && npx vitest run <path>`.

---

## File Structure

**Create:**
- `packages/agent/src/storage/session-lock.ts` — `withSessionLock(sessionDir, fn)`: sync
  `mkdir`+owner-token cross-process lock.
- `packages/agent/src/storage/seq-head.ts` — `readHead`, `reserveSeq`, `seedHead`,
  `reconcileHead` over `<sessionDir>/.seq`.
- `packages/agent/src/storage/__tests__/session-lock.test.ts`
- `packages/agent/src/storage/__tests__/seq-head.test.ts`
- `packages/agent/src/storage/__tests__/seq-concurrency.test.ts` (real subprocesses)
- `packages/agent/src/storage/__tests__/seq-crash.test.ts` (crash-injection)
- `packages/agent/src/storage/__tests__/_seq-append-child.ts` (helper script the
  concurrency/crash tests spawn)

**Modify:**
- `packages/agent/src/storage/event-log.ts` — `appendDurableEvent` assigns seq via the
  locked head reserve.
- `packages/agent/src/storage/session-store.ts` — stop repairing/rewriting
  `state.nextEventSeq` from a JSONL scan; reconcile the head on open instead.

---

## Task 1: The cross-process lock (`session-lock.ts`)

**Files:** `session-lock.ts`, `session-lock.test.ts`

- [ ] **Step 1: Failing tests** — mutual exclusion, owner-token-safe release, stale
  reclaim, re-entrancy is NOT supported (nested acquire of the same lock in the same
  process must not deadlock the test — design it non-reentrant and document):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSessionLock, SEQ_LOCK_STALE_MS } from '@lace/agent/storage/session-lock';

describe('withSessionLock', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lace-lock-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runs the critical section and releases (lock dir gone after)', () => {
    const r = withSessionLock(dir, () => 42);
    expect(r).toBe(42);
    expect(existsSync(join(dir, '.seq.lock'))).toBe(false);
  });

  it('releases even if the critical section throws', () => {
    expect(() => withSessionLock(dir, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(join(dir, '.seq.lock'))).toBe(false);
  });

  it('reclaims a STALE lock (older than the threshold) left by a dead holder', () => {
    // Simulate a dead holder: an old lock dir with a foreign token.
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'dead-process-token');
    // Backdate it beyond the staleness threshold.
    const old = Date.now() / 1000 - (SEQ_LOCK_STALE_MS / 1000) - 5;
    require('node:fs').utimesSync(lockDir, old, old);
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
  });

  it('does NOT reclaim a fresh foreign lock (times out)', () => {
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'live-other-token'); // fresh mtime
    expect(() => withSessionLock(dir, () => 'should-not-run', { timeoutMs: 200 }))
      .toThrow(/lock timeout/i);
    rmSync(lockDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement the lock.** Core guarantees: `mkdir` is atomic cross-process
  (one winner); a unique owner token written inside makes release safe (only the owner
  removes it, so an un-hung former holder cannot delete a successor's lock); staleness
  reclaim only removes a lock whose mtime is older than `SEQ_LOCK_STALE_MS` (set it well
  above the sub-10ms critical section — e.g. 30_000 — so a live holder is never
  false-reclaimed).

```ts
// ABOUTME: A per-session cross-process advisory lock for the durable-append critical
// section. mkdir() is atomic across processes (one winner); a unique owner token makes
// release safe against a stale-reclaim race (a former holder cannot delete a
// successor's lock). The critical section (read head, write head, append one JSONL
// line) is sub-10ms, so the staleness threshold can be generous enough that a live
// holder is never false-reclaimed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SEQ_LOCK_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SPIN_MS = 5;

export function withSessionLock<T>(sessionDir: string, fn: () => T, opts?: { timeoutMs?: number }): T {
  const lockDir = path.join(sessionDir, '.seq.lock');
  const ownerPath = path.join(lockDir, 'owner');
  const token = randomUUID();
  const deadline = nowMs() + (opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // acquire
  for (;;) {
    try {
      fs.mkdirSync(lockDir); // atomic; throws EEXIST if held
      fs.writeFileSync(ownerPath, token, { encoding: 'utf8' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // held — reclaim if stale
      tryReclaimStale(lockDir);
      if (nowMs() > deadline) throw new Error(`session-lock timeout on ${lockDir}`);
      spin(SPIN_MS);
    }
  }

  // critical section
  try {
    return fn();
  } finally {
    // release ONLY if we still own it (a stale-reclaim by another process changes the token)
    try {
      const cur = fs.readFileSync(ownerPath, 'utf8');
      if (cur === token) fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // owner file gone / lock already reclaimed — nothing to release
    }
  }
}

function tryReclaimStale(lockDir: string): void {
  try {
    const age = nowMs() - fs.statSync(lockDir).mtimeMs;
    if (age > SEQ_LOCK_STALE_MS) {
      // best-effort; mkdir is the real gate, so a double-reclaim is harmless
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch {
    // stat failed (lock vanished) — fine
  }
}

function nowMs(): number { return Number(process.hrtime.bigint() / 1_000_000n); }
function spin(ms: number): void {
  const end = nowMs() + ms;
  while (nowMs() < end) { /* busy-wait; the section is sub-ms so contention is brief */ }
}
```

> The busy-wait `spin` is acceptable because the critical section is sub-10ms and
> contention is rare (Jesse confirmed cross-process appends "should not" happen; this is
> the safety net). If a reviewer objects to busy-wait, replace with a tiny blocking sleep
> (`Atomics.wait` on a SharedArrayBuffer) — but do NOT make the function async. `nowMs`
> via `process.hrtime` avoids the banned `Date.now()` in non-test code paths; confirm the
> repo's stance and use the real clock the rest of `event-log.ts` uses (it uses
> `new Date().toISOString()` for timestamps, so wall-clock is allowed here).

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/storage/session-lock.ts packages/agent/src/storage/__tests__/session-lock.test.ts
git commit -m "feat(session-state): per-session cross-process mkdir+token lock"
```

---

## Task 2: The head file (`seq-head.ts`)

**Files:** `seq-head.ts`, `seq-head.test.ts`

- [ ] **Step 1: Failing tests** — read/seed/reserve/reconcile semantics, head stores the
  **next-free** seq, reconcile is monotonic and never below `MAX(JSONL)+1`:

```ts
import { readHead, reserveSeq, reconcileHead } from '@lace/agent/storage/seq-head';
// ... temp sessionDir with some JSONL events up to seq 10 ...

it('seeds from MAX(JSONL)+1 when the head is missing', () => {
  // .seq absent; JSONL max = 10
  expect(reserveSeq(sessionDir, deriveMaxJsonl)).toBe(11); // returns the reserved seq
  expect(readHead(sessionDir)).toBe(12); // head advanced to next-free
});
it('reserve is strictly increasing', () => {
  const a = reserveSeq(sessionDir, deriveMaxJsonl);
  const b = reserveSeq(sessionDir, deriveMaxJsonl);
  expect(b).toBe(a + 1);
});
it('reconcile never lowers the head and floors at MAX(JSONL)+1', () => {
  writeHead(sessionDir, 5);           // stale head below JSONL max 10
  reconcileHead(sessionDir, () => 10); // MAX(JSONL)=10
  expect(readHead(sessionDir)).toBe(11);
  reconcileHead(sessionDir, () => 3);  // lower — must not move down
  expect(readHead(sessionDir)).toBe(11);
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement.** `reserveSeq(sessionDir, deriveMaxJsonl)`: read the head (or
  seed = `deriveMaxJsonl()+1` if missing); `seq = head`; write head = `seq+1`; return
  `seq`. **Caller holds the lock.** `reconcileHead(sessionDir, deriveMaxJsonl)`:
  `head = MAX(readHead()|0, deriveMaxJsonl()+1)`; write it. Head file = a single integer
  as text. `deriveMaxJsonl` is injected (the caller passes
  `() => deriveNextEventSeqAcrossSessionFiles(...) - 1` or a max helper) so this module
  has no shard-discovery dependency.

> Note: `deriveNextEventSeqAcrossSessionFiles` returns `MAX+1`; so `MAX(JSONL) =
> deriveNextEventSeqAcrossSessionFiles(...) - 1` and `MAX(JSONL)+1 =
> deriveNextEventSeqAcrossSessionFiles(...)`. Use the existing function as the seed
> source to avoid duplicating shard discovery; the `+1`/`-1` bookkeeping must be exact —
> add a test that the seeded first seq equals what the OLD code would have assigned.

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/storage/seq-head.ts packages/agent/src/storage/__tests__/seq-head.test.ts
git commit -m "feat(session-state): per-session monotonic head file (next-free seq)"
```

---

## Task 3: Cut `appendDurableEvent` to the locked head reserve

**Files:** `event-log.ts`

- [ ] **Step 1: Failing test** — the first append to a session that already has JSONL
  events (seq up to N) gets seq N+1 (parity with the old derive); two sequential appends
  get strictly increasing seqs; and the head file ends at the right next-free value.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement.** Wrap the seq assignment + JSONL append in
  `withSessionLock(sessionDir, () => { ... })`, replacing the `deriveNextEventSeq...`
  line. Inside the lock: `const eventSeq = reserveSeq(sessionDir, () => deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId) - 1);`
  (head reserve, seeding on first use), then the existing newline-guard + `appendFileSync`
  with `seq=eventSeq`. **Reserve-before-append is guaranteed because `reserveSeq` writes
  head `H+1` before returning `H`, and the JSONL append follows.** Keep the turn_end dedup
  (`findTurnEndEventByTurnId`) — but move it INSIDE the lock and BEFORE the reserve, so a
  duplicate turn_end neither reserves a seq nor appends (read the JSONL under the lock; it
  is the truth, never stale). The recall/journal write-through stays OUTSIDE the lock
  (best-effort, not correctness).

> The seed's `deriveNextEventSeqAcrossSessionFiles` runs only on the FIRST append per
> session per process (when `.seq` is absent); thereafter `reserveSeq` is a pure head
> read/increment — no scan. Confirm `.seq` persists so the scan is one-time.
> `nextState.nextEventSeq = eventSeq + 1` stays for compatibility but is no longer an
> authority (Task 5 retires its repair).

- [ ] **Step 4: GREEN; run the full storage + event-log + runner suites.**

Run: `cd packages/agent && npx vitest run src/storage src/core/conversation && npx tsc --noEmit`
Expected: PASS. The `.seq` lock dir + `.seq` file appear in session dirs — confirm no
test asserts an exact session-dir file listing that would break.

- [ ] **Step 5: Commit.**

```bash
git add packages/agent/src/storage/event-log.ts packages/agent/src/storage/__tests__/event-log.test.ts
git commit -m "feat(session-state): assign eventSeq via locked head reserve (no per-append scan)"
```

---

## Task 4: Real two-subprocess concurrency + crash-injection tests

**Files:** `_seq-append-child.ts`, `seq-concurrency.test.ts`, `seq-crash.test.ts`

This is the gold-standard proof. It spawns REAL OS processes.

- [ ] **Step 1: The child script** `_seq-append-child.ts` — given a sessionDir + a count,
  appends `count` events via `appendDurableEvent` and exits. (A thin wrapper so the test
  can spawn it with `node`/`tsx`.)

- [ ] **Step 2: Concurrency test** — spawn N (e.g. 4) children that each append M (e.g.
  50) events to the SAME sessionDir concurrently; wait for all; then read every JSONL
  line across all shards and assert: every `eventSeq` is **unique** (no dup), the set is
  **monotonic with gaps allowed**, and the count of distinct seqs == N*M (no lost
  appends). This is the test that proves the lock prevents the cross-process dup race.

```ts
// Spawn children; collect; then:
const seqs = allEventSeqsAcrossShards(sessionDir);
expect(new Set(seqs).size).toBe(seqs.length); // NO DUPLICATES
expect(seqs.length).toBe(N * M);               // no lost appends
const sorted = [...seqs].sort((a, b) => a - b);
for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBeGreaterThan(sorted[i - 1]); // strictly increasing
```

> Use `node:child_process` `spawnSync`/`spawn`. Run the child via the repo's TS runner
> (check how other spawn-based tests run TS — `tsx`? a prebuilt entry?). If spawning TS
> is awkward, compile the child or use a `.mjs` shim that imports the built module. Mark
> this test appropriately if it must run under `--no-file-parallelism` (it spawns
> processes); the agent package already runs `src/__tests__` serially.

- [ ] **Step 3: Crash-injection test** — assert reserve-before-append yields a GAP, not a
  dup, when a process dies between the head reserve and the JSONL append. Drive this
  deterministically: a child that calls `reserveSeq` (advancing the head) then `exit(1)`
  BEFORE appending; then a normal append; assert the JSONL has NO duplicate seq and the
  burned seq is simply absent (a gap). (You may need a tiny test-only seam to reserve
  without appending — e.g. call `reserveSeq` directly in the child — that's fine; it
  exercises the exact crash window.)

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/storage/__tests__/_seq-append-child.ts packages/agent/src/storage/__tests__/seq-concurrency.test.ts packages/agent/src/storage/__tests__/seq-crash.test.ts
git commit -m "test(session-state): two-subprocess seq concurrency + crash-injection (no dup, gaps ok)"
```

---

## Task 5: Retire `SessionState.nextEventSeq` as an authority

**Files:** `session-store.ts`

- [ ] **Step 1: Failing test** — opening a session whose head/JSONL have a GAP does NOT
  rewrite `state.json` on every load (today's repair would, because gaps make
  `nextEventSeq` != `MAX(JSONL)+1` mismatch its expectation).

- [ ] **Step 2: RED** (the current `loadSession` repair rewrites state when
  `state.nextEventSeq !== deriveNextEventSeqFromEventLog`).

- [ ] **Step 3: Implement.** In `loadSession`, replace the `state.nextEventSeq` repair
  with `reconcileHead(sessionDir, () => deriveNextEventSeqAcrossSessionFiles(...) - 1)`
  (the head becomes the reconciled authority on open). Keep `state.nextEventSeq` as a
  derived/advisory field (set it from the reconciled head for back-compat) but DO NOT
  drive seq assignment from it and DO NOT rewrite state.json solely to "repair" it. Read
  `session-store.ts:~284` and the `readSessionState` corruption guard
  (`session-store.ts:~160`) and ensure the guard's intent (a bad nextEventSeq must not
  wedge turns) is preserved by the head reconcile.

- [ ] **Step 4: GREEN; full suite + typecheck + lint.**

Run (repo root): `npm run typecheck && npm run lint`
Run: `cd packages/agent && npx vitest run src/storage src/core/conversation src/providers/__tests__/golden`
Expected: PASS. Goldens/sent-vs-rebuilt unchanged (seq assignment doesn't change wire bytes — seqs are not sent to providers).

- [ ] **Step 5: Commit + evergreen doc.**

Add a section to `docs/architecture/prompt-cache-stability.md` (or a session-state doc):
present-tense, no refs — "Event sequence numbers are assigned under a per-session file
lock from a monotonic head file (`<sessionDir>/.seq`), reserve-before-append so a crash
yields a gap rather than a duplicate; the head reconciles to `MAX(JSONL)+1` on open. Seqs
are unique and monotonic; gaps are normal and every consumer tolerates them."

```bash
git add packages/agent/src/storage/session-store.ts docs/architecture/prompt-cache-stability.md
git commit -m "refactor(session-state): head file is the seq authority; retire nextEventSeq repair"
```

---

## Self-review notes (for the executor) — READ THESE

- **The corruption invariant:** reserve-before-append (head `H+1` written before JSONL
  `seq=H`) + the lock held across the append + reconcile-on-open. If any of those three is
  violated, you can get a duplicate seq. The two-subprocess test (Task 4) is the proof —
  if it ever shows a duplicate, STOP; the design is being violated.
- **Lock release safety:** release only if the owner token still matches (a stale-reclaim
  changed it). Never `rmSync` the lock unconditionally in `finally`.
- **Do NOT make `appendDurableEvent` async** (20 sync call sites). The lock is sync.
- **turn_end dedup reads the JSONL under the lock** (the truth) — never the lagging
  `event_journal`.
- **Out of scope:** the `event_journal` (3.1, done), the injects tail-read (3.2, done),
  the projection/snapshots (Steps 4-5).
- **After this plan is GREEN, it is RE-REVIEWED (adversarial) before any deploy to Ada.**
  Do not deploy from this plan; hand back for review.
