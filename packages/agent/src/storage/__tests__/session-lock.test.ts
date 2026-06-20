// ABOUTME: Tests for the per-session cross-process mkdir+owner-record lock.
// ABOUTME: Covers mutual exclusion, owner-token-safe release, and identity-based reclaim
// ABOUTME: (pid + /proc start-time) that is immune to pid reuse across container restarts.
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
import { withSessionLock, SEQ_LOCK_STALE_MS, parseProcStartTime } from '../session-lock';

/** This host's boot id, mirroring the lock's best-effort probe. */
function thisBootId(): string | null {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return null;
  }
}

/** This process's real /proc start-time (field 22), or null off-Linux. */
function thisStartTime(): number | null {
  try {
    return parseProcStartTime(readFileSync(`/proc/${process.pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

interface PlantRecord {
  token: string;
  pid: number;
  bootId: string | null;
  startTime: number | null;
  ts: number;
}

/** Write a JSON owner record into a lock dir and backdate its mtime past the threshold. */
function plantStaleOwner(lockDir: string, record: PlantRecord): void {
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner'), JSON.stringify(record));
  const old = Date.now() / 1000 - SEQ_LOCK_STALE_MS / 1000 - 5;
  utimesSync(lockDir, old, old);
}

/** Write a JSON owner record into a lock dir, leaving its mtime FRESH (just now). */
function plantOwner(lockDir: string, record: PlantRecord): void {
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner'), JSON.stringify(record));
}

describe('parseProcStartTime', () => {
  it('extracts field 22 (start-time) from a real /proc/self/stat line', () => {
    // A real-shaped line: pid (comm) state ppid ... field22 ...
    const line =
      '3170114 (cat) R 3170112 3170112 3170112 0 -1 4194304 127 0 0 0 0 0 0 0 20 0 1 0 198438773 5971968 480';
    expect(parseProcStartTime(line)).toBe(198438773);
  });

  it('parses from the LAST ) so a comm with spaces and parens does not shift fields', () => {
    // comm = "(weird ) name)" — embedded spaces AND a paren. Naive split would
    // mis-count; parsing after the last ) keeps field 22 correct.
    const line = '42 ((weird ) name)) R 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 999000 1 1';
    expect(parseProcStartTime(line)).toBe(999000);
  });

  it('returns null when there is no closing paren', () => {
    expect(parseProcStartTime('not a stat line')).toBe(null);
  });

  it('returns null when field 22 is missing', () => {
    expect(parseProcStartTime('42 (cat) R 1 2 3')).toBe(null);
  });

  it('round-trips this process: re-parsing the same pid yields the same value', () => {
    const a = thisStartTime();
    const b = thisStartTime();
    expect(a).not.toBe(null);
    expect(a).toBe(b);
  });
});

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

  it('writes a JSON owner record (token, pid, bootId, startTime) on acquire', () => {
    let record: { token?: unknown; pid?: unknown; bootId?: unknown; startTime?: unknown } = {};
    withSessionLock(dir, () => {
      record = JSON.parse(readFileSync(join(dir, '.seq.lock', 'owner'), 'utf8')) as typeof record;
    });
    expect(typeof record.token).toBe('string');
    expect(record.pid).toBe(process.pid);
    expect(record.bootId === null || typeof record.bootId === 'string').toBe(true);
    // On Linux /proc the start-time is recorded; null only off-Linux.
    expect(record.startTime === null || typeof record.startTime === 'number').toBe(true);
    if (thisStartTime() !== null) expect(record.startTime).toBe(thisStartTime());
  });

  it('does NOT reclaim a LIVE holder (matching pid+startTime) even with a backdated mtime', () => {
    // A live holder: our OWN pid (alive) + this boot's bootId + our REAL
    // start-time, with the lock-dir mtime backdated well past the threshold.
    // mtime alone would say "stale"; identity (pid+startTime) says "alive" → must
    // NOT reclaim.
    const lockDir = join(dir, '.seq.lock');
    plantStaleOwner(lockDir, {
      token: 'live-holder-token',
      pid: process.pid,
      bootId: thisBootId(),
      startTime: thisStartTime(),
      ts: Date.now(),
    });
    expect(() => withSessionLock(dir, () => 'should-not-run', { timeoutMs: 200 })).toThrow(
      /timeout/i
    );
    expect(existsSync(lockDir)).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('reclaims a DEAD holder (pid not running) with a backdated mtime', () => {
    // A pid that does not exist (2^30) → /proc/<pid>/stat is absent → dead →
    // reclaim even though the token is foreign.
    const lockDir = join(dir, '.seq.lock');
    plantStaleOwner(lockDir, {
      token: 'dead-holder-token',
      pid: 2 ** 30,
      bootId: thisBootId(),
      startTime: 123456,
      ts: Date.now(),
    });
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
  });

  it('reclaims a PID-REUSE stale holder: pid is ALIVE but its start-time differs (THE INCIDENT)', () => {
    // The exact outage, reproduced. The dead holder recorded pid 55 + this host's
    // bootId (the HOST boot_id is stable across container restarts) + the dead
    // process's own start-time. After a container restart, pid 55 is reborn ALIVE
    // (the pid namespace resets; lace lands on the same low pid). A bare
    // pid-liveness probe sees "alive" and NEVER reclaims → 2109 crash-restarts.
    //
    // We model it with a pid that IS alive right now (our own) but a start-time
    // that does NOT match it — the impostor signature of a reused pid. The lock
    // must be broken and acquisition must succeed.
    const lockDir = join(dir, '.seq.lock');
    const real = thisStartTime();
    expect(real).not.toBe(null); // this test is meaningful only on Linux /proc
    plantOwner(lockDir, {
      token: 'reused-pid-token',
      pid: process.pid, // ALIVE right now
      bootId: thisBootId(), // SAME host boot — bootId never disambiguates this
      startTime: (real as number) + 1, // wrong start-time ⇒ pid was reused ⇒ dead
      ts: Date.now(), // fresh ts + fresh mtime — the mtime rule would NOT save us
    });
    const r = withSessionLock(dir, () => 'reclaimed', { timeoutMs: 1000 });
    expect(r).toBe('reclaimed');
  });

  it('reclaims a stale CROSS-BOOT holder immediately (host reboot fast path)', () => {
    // A genuine host-kernel reboot: the recorded bootId differs from this boot's.
    // That boot is over → the holder is gone → break immediately even with a fresh
    // mtime and a "live"-looking pid. (Secondary signal: not the container case,
    // which keeps the same bootId — but still correct after a real host reboot.)
    const lockDir = join(dir, '.seq.lock');
    plantOwner(lockDir, {
      token: 'previous-boot-token',
      pid: process.pid,
      bootId: 'a-different-boot-00000000-0000-0000-0000-000000000000',
      startTime: thisStartTime(),
      ts: Date.now(),
    });
    const r = withSessionLock(dir, () => 'reclaimed', { timeoutMs: 1000 });
    expect(r).toBe('reclaimed');
  });

  it('two acquirers racing on a stale pid-reuse lock → exactly one acquires (no double-acquire)', () => {
    // Concurrent stale-break must elect a single winner: the mkdir is the sole
    // atomic gate and the conditional break never deletes a successor's lock.
    // We can't fork real processes in a unit test, so we model the race by
    // entering the critical section once (acquirer A wins by breaking the stale
    // pid-reuse lock) and, from inside it, attempting a second acquire (B) — B
    // must NOT also acquire while A holds A's fresh, live lock.
    const lockDir = join(dir, '.seq.lock');
    const real = thisStartTime();
    expect(real).not.toBe(null);
    plantOwner(lockDir, {
      token: 'reused-pid-token',
      pid: process.pid,
      bootId: thisBootId(),
      startTime: (real as number) + 1, // reused-pid impostor
      ts: Date.now(),
    });
    let bothInside = false;
    const a = withSessionLock(
      dir,
      () => {
        // A broke the stale lock and now holds a fresh one carrying A's REAL
        // start-time. B tries to acquire: A is live (pid+startTime match) → B must
        // time out rather than steal A's lock.
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
    expect(existsSync(lockDir)).toBe(false);
  });

  it('falls back to the mtime rule for a legacy owner WITHOUT startTime (reclaims if old)', () => {
    // A pre-startTime owner record (bare pid, no startTime) with a stale mtime:
    // a bare pid is untrustworthy (pids are reused), so liveness is unknowable →
    // reclaim by the mtime rule.
    const lockDir = join(dir, '.seq.lock');
    plantStaleOwner(lockDir, {
      token: 'legacy-token',
      pid: process.pid, // alive pid, but no startTime to trust it
      bootId: thisBootId(),
      startTime: null,
      ts: Date.now(),
    });
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
  });

  it('does NOT reclaim a legacy owner WITHOUT startTime that is still fresh (times out)', () => {
    const lockDir = join(dir, '.seq.lock');
    plantOwner(lockDir, {
      token: 'legacy-token',
      pid: process.pid,
      bootId: thisBootId(),
      startTime: null,
      ts: Date.now(), // fresh mtime
    });
    expect(() => withSessionLock(dir, () => 'should-not-run', { timeoutMs: 200 })).toThrow(
      /timeout/i
    );
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('falls back to the mtime rule for an unparseable (raw-token) owner file', () => {
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'legacy-raw-token');
    const old = Date.now() / 1000 - SEQ_LOCK_STALE_MS / 1000 - 5;
    utimesSync(lockDir, old, old);
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
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
        JSON.stringify({
          token: 'successor-token',
          pid: process.pid,
          bootId: null,
          startTime: null,
          ts: Date.now(),
        })
      );
    });
    // The successor's lock dir + owner record must still be present.
    expect(existsSync(lockDir)).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });
});
