// ABOUTME: A per-session cross-process advisory lock for the durable-append critical
// ABOUTME: section. mkdir() is atomic across processes (one winner); a JSON owner record
// (token+pid+bootId) makes release safe against a stale-reclaim race AND lets reclaim
// check holder LIVENESS (process.kill(pid,0)) instead of trusting a frozen dir-mtime — a
// live holder stalled past the mtime threshold (GC/swap/CPU-throttle) is NEVER reclaimed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

// mtime FALLBACK threshold — used ONLY when holder liveness is unknowable (the
// owner record is unparseable, or its bootId is null/from a different boot so a
// pid on THIS host means nothing). A live holder on this boot is gated by the
// pid-liveness probe, not by mtime, so this threshold can be generous: it should
// only ever fire for a genuinely dead/hung holder we cannot probe. 5 minutes is
// far above the sub-10ms critical section, so a slow-but-live holder in the
// unknowable case is still extremely unlikely to be false-reclaimed.
export const SEQ_LOCK_STALE_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SPIN_MS = 5;

interface OwnerRecord {
  token: string;
  pid: number;
  bootId: string | null;
  ts: number;
}

/** This host's boot id (Linux), or null if unreadable. Best-effort. */
function readBootId(): string | null {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return null;
  }
}

/** True if `pid` is a live process on this host (process.kill(pid, 0) probe). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // signal accepted → alive (or EPERM, handled below)
  } catch (err) {
    // ESRCH → no such process (dead). EPERM → process exists but is ours-to-not
    // signal → treat as ALIVE (never reclaim a process we know exists).
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseOwnerRecord(raw: string): OwnerRecord | undefined {
  try {
    const o = JSON.parse(raw) as Partial<OwnerRecord>;
    if (typeof o.token === 'string' && typeof o.pid === 'number') {
      return { token: o.token, pid: o.pid, bootId: o.bootId ?? null, ts: o.ts ?? 0 };
    }
  } catch {
    // not JSON (legacy raw-token file or torn write)
  }
  return undefined;
}

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
      const record: OwnerRecord = {
        token,
        pid: process.pid,
        bootId: readBootId(),
        ts: Date.now(),
      };
      fs.writeFileSync(ownerPath, JSON.stringify(record), { encoding: 'utf8' });
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
      const cur = parseOwnerRecord(fs.readFileSync(ownerPath, 'utf8'));
      if (cur?.token === token) fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // owner file gone / lock already reclaimed — nothing to release
    }
  }
}

/**
 * Reclaim a held lock ONLY when its holder is provably gone (or unknowable AND
 * ancient). Liveness — not the frozen dir-mtime — is the authority:
 *
 *  - Owner record unparseable (legacy raw-token / torn write) → liveness is
 *    unknowable → fall back to the mtime rule (reclaim only if older than
 *    SEQ_LOCK_STALE_MS).
 *  - Owner record on THIS boot (bootId matches) → probe the pid:
 *      · dead (ESRCH) → reclaim.
 *      · alive → return WITHOUT reclaiming, regardless of mtime. A live holder
 *        stalled past any threshold (GC/swap/CPU-throttle) is never reclaimed;
 *        the waiter keeps spinning until its own timeout. This is the fix for
 *        the duplicate-seq window where two processes entered the critical
 *        section because a frozen mtime falsely declared a live holder stale.
 *  - bootId null or from a DIFFERENT boot → a pid on this host is meaningless →
 *    fall back to the mtime rule (generous threshold).
 */
function tryReclaimStale(lockDir: string): void {
  let record: OwnerRecord | undefined;
  try {
    record = parseOwnerRecord(fs.readFileSync(path.join(lockDir, 'owner'), 'utf8'));
  } catch {
    // owner file missing/unreadable — fall through to the mtime rule
  }

  const thisBoot = readBootId();
  if (record && thisBoot !== null && record.bootId === thisBoot) {
    // Same boot: pid liveness is authoritative.
    if (pidAlive(record.pid)) return; // live holder — NEVER reclaim
    reclaim(lockDir); // dead holder (ESRCH) — reclaim
    return;
  }

  // Liveness unknowable (unparseable record, or cross-boot/null bootId):
  // reclaim only if the lock dir is older than the generous mtime threshold.
  reclaimIfMtimeStale(lockDir);
}

function reclaimIfMtimeStale(lockDir: string): void {
  try {
    // Staleness compares the lock dir's mtime against wall-clock epoch time.
    // `nowMs()` is a monotonic hrtime clock (good for relative timeout/spin
    // durations but NOT comparable to a filesystem mtime), so this comparison
    // must use Date.now() to stay on the same epoch as mtimeMs.
    const age = Date.now() - fs.statSync(lockDir).mtimeMs;
    if (age > SEQ_LOCK_STALE_MS) reclaim(lockDir);
  } catch {
    // stat failed (lock vanished) — fine
  }
}

function reclaim(lockDir: string): void {
  try {
    // best-effort; mkdir is the real gate, so a double-reclaim is harmless
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // already gone — fine
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
