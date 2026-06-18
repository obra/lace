// ABOUTME: A per-session cross-process advisory lock for the durable-append critical
// ABOUTME: section. mkdir() is atomic across processes (one winner); a unique owner token
// makes release safe against a stale-reclaim race (a former holder cannot delete a
// successor's lock). The critical section (read head, write head, append one JSONL line)
// is sub-10ms, so the staleness threshold can be generous enough that a live holder is
// never false-reclaimed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

// Staleness threshold: a lock dir whose mtime is older than this is treated as
// abandoned by a dead holder and reclaimed. It is set well above the sub-10ms
// critical section so a slow-but-live holder is never false-reclaimed.
export const SEQ_LOCK_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SPIN_MS = 5;

/**
 * Run `fn` while holding a per-session cross-process advisory lock on
 * `<sessionDir>/.seq.lock`. The lock is acquired via an atomic `mkdir` (one
 * winner cross-process) and a unique owner token is written inside it so
 * release only removes the lock we still own — a former holder whose lock was
 * stale-reclaimed by a successor will not delete the successor's lock.
 *
 * NOT re-entrant: a nested `withSessionLock` on the same sessionDir in the same
 * process will spin until the outer one releases or it times out. Callers must
 * not nest locks on the same session.
 */
export function withSessionLock<T>(
  sessionDir: string,
  fn: () => T,
  opts?: { timeoutMs?: number }
): T {
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
      if (nowMs() > deadline) throw new Error(`session-lock lock timeout on ${lockDir}`);
      spin(SPIN_MS);
    }
  }

  // critical section
  try {
    return fn();
  } finally {
    // Release ONLY if we still own it. A stale-reclaim by another process
    // rewrites the owner token, so an un-hung former holder cannot delete a
    // successor's lock.
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
    // Staleness compares the lock dir's mtime against wall-clock epoch time.
    // `nowMs()` is a monotonic hrtime clock (good for relative timeout/spin
    // durations but NOT comparable to a filesystem mtime), so this comparison
    // must use Date.now() to stay on the same epoch as mtimeMs.
    const age = Date.now() - fs.statSync(lockDir).mtimeMs;
    if (age > SEQ_LOCK_STALE_MS) {
      // best-effort; mkdir is the real gate, so a double-reclaim is harmless
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch {
    // stat failed (lock vanished) — fine
  }
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function spin(ms: number): void {
  const end = nowMs() + ms;
  while (nowMs() < end) {
    /* busy-wait; the critical section is sub-10ms so contention is brief */
  }
}
