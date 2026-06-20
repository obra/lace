// ABOUTME: A per-session cross-process advisory lock for the durable-append critical
// ABOUTME: section. mkdir() is atomic across processes (one winner); a JSON owner record
// (token+pid+bootId+startTime) makes release safe against a stale-reclaim race AND lets
// reclaim check holder LIVENESS — pid PLUS its /proc start-time, so a reused pid (a NEW
// process landing on the dead holder's pid after a container restart) is detected as dead,
// not mistaken for a live holder. A genuinely live holder stalled past the mtime threshold
// (GC/swap/CPU-throttle) is NEVER reclaimed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

// mtime FALLBACK threshold — used ONLY when holder liveness is unknowable: a
// legacy/torn owner record we cannot parse, or a record with no `startTime` so a
// bare pid on this host means nothing (pids are reused). A holder whose liveness
// IS knowable (pid + start-time) is gated by the start-time probe, not by mtime,
// so this threshold can be generous: it should only ever fire for a genuinely
// dead/hung holder we cannot probe. 5 minutes is far above the sub-10ms critical
// section, so a slow-but-live holder in the unknowable case is still extremely
// unlikely to be false-reclaimed.
export const SEQ_LOCK_STALE_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SPIN_MS = 5;

interface OwnerRecord {
  token: string;
  pid: number;
  bootId: string | null;
  // The holder pid's process start-time (/proc/<pid>/stat field 22, jiffies
  // since host boot). With pid, this uniquely identifies the holder process: a
  // reused pid belongs to a process with a DIFFERENT start-time, so it reads as
  // dead. null on a legacy record written before this field existed, or when
  // /proc was unreadable at acquire → liveness is unknowable → mtime fallback.
  startTime: number | null;
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

/**
 * The start-time (field 22, jiffies since host boot) from a /proc/<pid>/stat
 * line, or null if absent/malformed. Field 2 (comm) is wrapped in parens and may
 * itself contain spaces and parens (e.g. `(some )( name)`), so we parse the
 * fixed-width tail by splitting AFTER the LAST `)`: everything past it is the
 * space-separated fields starting at field 3 (state). field 22 is then index 19
 * (22 − 3) of that tail.
 */
export function parseProcStartTime(stat: string): number | null {
  const close = stat.lastIndexOf(')');
  if (close === -1) return null;
  const tail = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // tail[0] = field 3 (state); field 22 = tail[22 - 3] = tail[19].
  const raw = tail[19];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** This process's own /proc start-time, or null if /proc is unreadable. */
function readSelfStartTime(): number | null {
  return readPidStartTime(process.pid);
}

/** The start-time recorded for `pid` in /proc/<pid>/stat, or null if gone/unreadable. */
function readPidStartTime(pid: number): number | null {
  try {
    return parseProcStartTime(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null; // no such pid, or /proc not mounted
  }
}

/**
 * True iff the recorded holder is still the live process it was at acquire.
 * Identity = (pid, startTime): /proc/<pid>/stat must exist AND carry the SAME
 * start-time. A pid that is gone, or whose start-time differs (⇒ the pid was
 * reused by a newer process), reads as DEAD. Immune to pid reuse within a host
 * boot, which is exactly the container-restart case (pid 55 reborn each boot).
 *
 * Returns undefined when liveness is unknowable: the record predates the
 * startTime field (legacy null), or /proc/self could not be read so we have no
 * trustworthy clock to compare against — the caller then defers to mtime.
 */
function isHolderAlive(record: OwnerRecord): boolean | undefined {
  if (record.startTime === null) return undefined; // legacy record — unknowable
  const live = readPidStartTime(record.pid);
  if (live === null) {
    // The pid is gone. But if /proc itself is unreadable here (no Linux /proc),
    // we cannot distinguish "dead" from "can't tell" — fall back to mtime.
    if (readSelfStartTime() === null) return undefined;
    return false; // pid genuinely absent on a working /proc → dead
  }
  return live === record.startTime;
}

function parseOwnerRecord(raw: string): OwnerRecord | undefined {
  try {
    const o = JSON.parse(raw) as Partial<OwnerRecord>;
    if (typeof o.token === 'string' && typeof o.pid === 'number') {
      return {
        token: o.token,
        pid: o.pid,
        bootId: o.bootId ?? null,
        startTime: typeof o.startTime === 'number' ? o.startTime : null,
        ts: o.ts ?? 0,
      };
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
        startTime: readSelfStartTime(),
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
 * ancient). Holder IDENTITY (pid + /proc start-time) — not the frozen dir-mtime,
 * and not pid alone — is the authority:
 *
 *  - Owner record from a DIFFERENT host boot (both bootIds non-null, mismatched)
 *    → the host kernel rebooted, so the recorded pid AND its start-time belong to
 *    a vanished boot → break immediately, with no mtime/TTL wait. This is a fast
 *    "definitely dead" signal; it is NOT the sole reliance for the common
 *    container-restart case, where the HOST boot_id is unchanged (only the
 *    container's pid namespace reset) so bootId still matches.
 *  - Otherwise probe holder identity via isHolderAlive(record):
 *      · alive (pid present AND its /proc start-time matches the recorded one) →
 *        return WITHOUT reclaiming, regardless of mtime. A live holder stalled
 *        past any threshold (GC/swap/CPU-throttle) is never reclaimed.
 *      · dead (pid gone, OR its start-time differs ⇒ the pid was REUSED by a
 *        newer process after a container restart) → break it. This is the cure
 *        for the outage: a dead holder's pid (e.g. 55) is reborn alive each
 *        container boot, so a bare pid-liveness probe wrongly saw "alive" and
 *        never reclaimed; the start-time mismatch exposes the impostor.
 *      · unknowable (legacy record without startTime, or /proc unreadable) →
 *        fall back to the mtime rule (reclaim only if older than
 *        SEQ_LOCK_STALE_MS).
 *
 * Every break routes through breakIfOwner, which re-reads the owner token and
 * removes the dir only if it still carries the stale token, so two racers
 * electing the same stale lock cannot both win: mkdir remains the single atomic
 * arbiter and the conditional rm never deletes a successor's freshly-acquired
 * lock.
 */
function tryReclaimStale(lockDir: string): void {
  let record: OwnerRecord | undefined;
  try {
    record = parseOwnerRecord(fs.readFileSync(path.join(lockDir, 'owner'), 'utf8'));
  } catch {
    // owner file missing/unreadable — fall through to the mtime rule
  }

  if (record) {
    const thisBoot = readBootId();
    if (thisBoot !== null && record.bootId !== null && record.bootId !== thisBoot) {
      // Host kernel rebooted → the holder's boot is over → it is gone. Fast path,
      // independent of pid/start-time (both belong to the vanished boot).
      breakIfOwner(lockDir, record.token);
      return;
    }
    const alive = isHolderAlive(record);
    if (alive === true) return; // live holder — NEVER reclaim
    if (alive === false) {
      // Dead: pid gone, or its start-time differs (pid reused). Break it.
      breakIfOwner(lockDir, record.token);
      return;
    }
    // alive === undefined → liveness unknowable → mtime rule below.
  }

  // Liveness/identity unknowable (unparseable record, or a record with no
  // startTime / unreadable /proc): reclaim only if the lock dir is older than the
  // generous mtime rule.
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

/**
 * Break a stale lock ONLY if its owner record still carries `staleToken` — the
 * exact identity we judged stale. Re-reading the token immediately before the rm
 * closes the break race: if a concurrent waiter already broke and re-acquired
 * the lock, its owner record now carries a fresh token, so this rm is skipped
 * and the successor's lock is preserved. The atomic `mkdirSync` in the acquire
 * loop is the single winner gate; this conditional rm only ever removes the
 * specific stale dir, never a successor's.
 */
function breakIfOwner(lockDir: string, staleToken: string): void {
  try {
    const cur = parseOwnerRecord(fs.readFileSync(path.join(lockDir, 'owner'), 'utf8'));
    if (cur?.token !== staleToken) return; // a successor already re-acquired
  } catch {
    return; // owner gone / unreadable — nothing of ours to break
  }
  reclaim(lockDir);
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
