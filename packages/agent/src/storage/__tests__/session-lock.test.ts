// ABOUTME: Tests for the per-session cross-process mkdir+owner-record lock.
// ABOUTME: Covers mutual exclusion, owner-token-safe release, and liveness-based reclaim.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSessionLock, SEQ_LOCK_STALE_MS } from '../session-lock';

/** This host's boot id, mirroring the lock's best-effort probe. */
function thisBootId(): string | null {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return null;
  }
}

/** Write a JSON owner record into a lock dir and backdate its mtime past the threshold. */
function plantStaleOwner(
  lockDir: string,
  record: { token: string; pid: number; bootId: string | null; ts: number }
): void {
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner'), JSON.stringify(record));
  const old = Date.now() / 1000 - SEQ_LOCK_STALE_MS / 1000 - 5;
  utimesSync(lockDir, old, old);
}

/** Write a JSON owner record into a lock dir, leaving its mtime FRESH (just now). */
function plantOwner(
  lockDir: string,
  record: { token: string; pid: number; bootId: string | null; ts: number }
): void {
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner'), JSON.stringify(record));
}

describe('withSessionLock', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runs the critical section and releases (lock dir gone after)', () => {
    const r = withSessionLock(dir, () => 42);
    expect(r).toBe(42);
    expect(existsSync(join(dir, '.seq.lock'))).toBe(false);
  });

  it('holds the lock during the critical section', () => {
    let seenDuring = false;
    withSessionLock(dir, () => {
      seenDuring = existsSync(join(dir, '.seq.lock'));
    });
    expect(seenDuring).toBe(true);
  });

  it('releases even if the critical section throws', () => {
    expect(() =>
      withSessionLock(dir, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(existsSync(join(dir, '.seq.lock'))).toBe(false);
  });

  it('writes a JSON owner record (token, pid, bootId) on acquire', () => {
    let record: { token?: unknown; pid?: unknown; bootId?: unknown } = {};
    withSessionLock(dir, () => {
      record = JSON.parse(readFileSync(join(dir, '.seq.lock', 'owner'), 'utf8')) as typeof record;
    });
    expect(typeof record.token).toBe('string');
    expect(record.pid).toBe(process.pid);
    expect(record.bootId === null || typeof record.bootId === 'string').toBe(true);
  });

  it('does NOT reclaim a LIVE holder even with a backdated (stale) mtime → times out', () => {
    // A live foreign holder: our OWN pid (provably alive) + this host's bootId,
    // but with a lock-dir mtime backdated well past the staleness threshold.
    // mtime alone would say "stale"; liveness says "alive" → must NOT reclaim.
    const lockDir = join(dir, '.seq.lock');
    plantStaleOwner(lockDir, {
      token: 'live-holder-token',
      pid: process.pid,
      bootId: thisBootId(),
      ts: Date.now(),
    });
    expect(() => withSessionLock(dir, () => 'should-not-run', { timeoutMs: 200 })).toThrow(
      /timeout/i
    );
    expect(existsSync(lockDir)).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('reclaims a DEAD holder (pid not alive → ESRCH) with a backdated mtime', () => {
    // A pid that does not exist (2^30) → process.kill(pid, 0) throws ESRCH →
    // holder is provably dead → reclaim even though the token is foreign.
    const lockDir = join(dir, '.seq.lock');
    plantStaleOwner(lockDir, {
      token: 'dead-holder-token',
      pid: 2 ** 30,
      bootId: thisBootId(),
      ts: Date.now(),
    });
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
  });

  it('reclaims a stale CROSS-BOOT holder immediately, even with a FRESH mtime', () => {
    // The exact outage: a holder from a PREVIOUS boot died without releasing.
    // lace runs in a container whose boot_id resets each boot, so the recorded
    // bootId differs from this boot's. That boot is over → the holder is gone →
    // the lock is unconditionally stale and must be broken WITHOUT waiting for
    // any mtime/TTL backstop (mtime is fresh here, pid looks alive → only the
    // cross-boot bootId mismatch proves staleness).
    const lockDir = join(dir, '.seq.lock');
    plantOwner(lockDir, {
      token: 'previous-boot-token',
      pid: process.pid, // a "live" pid (pid reuse hazard) — must be ignored
      bootId: 'a-different-boot-00000000-0000-0000-0000-000000000000',
      ts: Date.now(), // fresh ts; fresh mtime — the mtime rule would NOT save us
    });
    const r = withSessionLock(dir, () => 'reclaimed', { timeoutMs: 1000 });
    expect(r).toBe('reclaimed');
  });

  it('two acquirers racing on a stale cross-boot lock → exactly one acquires (no double-acquire)', () => {
    // Concurrent stale-break must elect a single winner: the mkdir is the sole
    // atomic gate and the conditional break never deletes a successor's lock.
    // We can't fork real processes in a unit test, so we model the race by
    // entering the critical section once (acquirer A wins) and, from inside it,
    // attempting a second acquire (acquirer B) — B must NOT also acquire while A
    // holds: it must block until A releases (or time out). The stale-break logic
    // must not let B steal A's freshly-minted lock.
    const lockDir = join(dir, '.seq.lock');
    plantOwner(lockDir, {
      token: 'previous-boot-token',
      pid: process.pid,
      bootId: 'a-different-boot-00000000-0000-0000-0000-000000000000',
      ts: Date.now(),
    });
    let bothInside = false;
    const a = withSessionLock(
      dir,
      () => {
        // A has broken the stale lock and now holds a fresh one. B tries to
        // acquire: it must time out (A's lock is live, same boot, A's pid alive)
        // rather than steal A's lock.
        let bAcquired = false;
        try {
          withSessionLock(
            dir,
            () => {
              bAcquired = true;
            },
            { timeoutMs: 100 }
          );
        } catch {
          // expected: B times out while A holds
        }
        bothInside = bAcquired; // must remain false → no double-acquire
        return 'a-held';
      },
      { timeoutMs: 1000 }
    );
    expect(a).toBe('a-held');
    expect(bothInside).toBe(false);
    // A released cleanly afterward.
    expect(existsSync(lockDir)).toBe(false);
  });

  it('falls back to the mtime rule for a legacy/unparseable owner file (reclaims if old)', () => {
    // An old-format owner file (raw token, not JSON) with a stale mtime: liveness
    // is unknowable, so reclaim by the mtime rule.
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'legacy-raw-token');
    const old = Date.now() / 1000 - SEQ_LOCK_STALE_MS / 1000 - 5;
    utimesSync(lockDir, old, old);
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
  });

  it('does NOT reclaim a legacy owner file that is still fresh (times out)', () => {
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'legacy-raw-token'); // fresh mtime
    expect(() => withSessionLock(dir, () => 'should-not-run', { timeoutMs: 200 })).toThrow(
      /timeout/i
    );
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('does NOT delete a successor lock on release after a stale-reclaim (owner-token-safe)', () => {
    // A former holder finishes its critical section AFTER another process
    // reclaimed its stale lock and took ownership. The former holder's release
    // must not remove the successor's lock dir, because the owner token differs.
    const lockDir = join(dir, '.seq.lock');
    withSessionLock(dir, () => {
      // While "we" hold the lock, simulate a successor that reclaimed it:
      // overwrite the owner record with a foreign token.
      writeFileSync(
        join(lockDir, 'owner'),
        JSON.stringify({ token: 'successor-token', pid: process.pid, bootId: null, ts: Date.now() })
      );
    });
    // The successor's lock dir + owner record must still be present.
    expect(existsSync(lockDir)).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });
});
