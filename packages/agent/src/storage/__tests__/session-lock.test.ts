// ABOUTME: Tests for the per-session cross-process mkdir+owner-token lock.
// ABOUTME: Covers mutual exclusion, owner-token-safe release, and stale reclaim.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSessionLock, SEQ_LOCK_STALE_MS } from '../session-lock';

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

  it('reclaims a STALE lock (older than the threshold) left by a dead holder', () => {
    // Simulate a dead holder: an old lock dir with a foreign token.
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'dead-process-token');
    // Backdate it beyond the staleness threshold (utimes takes seconds).
    const old = Date.now() / 1000 - SEQ_LOCK_STALE_MS / 1000 - 5;
    utimesSync(lockDir, old, old);
    const r = withSessionLock(dir, () => 'reclaimed');
    expect(r).toBe('reclaimed');
  });

  it('does NOT reclaim a fresh foreign lock (times out)', () => {
    const lockDir = join(dir, '.seq.lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner'), 'live-other-token'); // fresh mtime
    expect(() => withSessionLock(dir, () => 'should-not-run', { timeoutMs: 200 })).toThrow(
      /lock timeout/i
    );
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('does NOT delete a successor lock on release after a stale-reclaim (owner-token-safe)', () => {
    // A former holder finishes its critical section AFTER another process
    // reclaimed its stale lock and took ownership. The former holder's release
    // must not remove the successor's lock dir, because the owner token differs.
    const lockDir = join(dir, '.seq.lock');
    let successorTokenLockExistedAfter = false;
    withSessionLock(dir, () => {
      // While "we" hold the lock, simulate a successor that reclaimed it:
      // overwrite the owner token to a foreign value.
      writeFileSync(join(lockDir, 'owner'), 'successor-token');
    });
    // The successor's lock dir + owner token must still be present.
    successorTokenLockExistedAfter = existsSync(lockDir);
    expect(successorTokenLockExistedAfter).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });
});
