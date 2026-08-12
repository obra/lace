// ABOUTME: Turn beacon maintains $LACE_DIR/turn-active while a turn runs so
// ABOUTME: host-side deploy tooling can refuse to restart the agent mid-turn.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnBeacon, turnFlagPathForProcess } from '../turn-beacon';

describe('createTurnBeacon', () => {
  let dir: string;
  let flagPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'turn-beacon-'));
    flagPath = join(dir, 'turn-active');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the flag while a turn is active and removes it when idle', () => {
    let active = false;
    const beacon = createTurnBeacon({
      flagPath,
      isTurnActive: () => active,
      intervalMs: 1000,
    });
    beacon.start();

    vi.advanceTimersByTime(1000);
    expect(existsSync(flagPath)).toBe(false);

    active = true;
    vi.advanceTimersByTime(1000);
    expect(existsSync(flagPath)).toBe(true);

    active = false;
    vi.advanceTimersByTime(1000);
    expect(existsSync(flagPath)).toBe(false);

    beacon.stop();
  });

  it('keeps refreshing the flag across beats of a long turn', () => {
    const beacon = createTurnBeacon({
      flagPath,
      isTurnActive: () => true,
      intervalMs: 1000,
    });
    beacon.start();

    // The persisted updatedAt must advance beat over beat — mtime comparison
    // alone would pass even if the file were never rewritten.
    vi.advanceTimersByTime(1000);
    const first = JSON.parse(readFileSync(flagPath, 'utf8')) as { updatedAt: number };
    vi.advanceTimersByTime(5000);
    const later = JSON.parse(readFileSync(flagPath, 'utf8')) as { updatedAt: number };
    expect(later.updatedAt).toBeGreaterThan(first.updatedAt);

    beacon.stop();
  });

  it('beat(true) raises the flag synchronously without waiting for the interval', () => {
    const beacon = createTurnBeacon({
      flagPath,
      isTurnActive: () => true,
      intervalMs: 60_000,
    });

    beacon.beat(true);
    expect(existsSync(flagPath)).toBe(true);
    expect(readFileSync(flagPath, 'utf8')).toContain('updatedAt');
  });

  it('an idle process removes only its own flag, never a busy sibling', () => {
    // Root agent and delegate children share LACE_DIR; each beacons its own
    // per-pid file. A regression to a shared path would let the idle beacon
    // delete the busy one's marker and let a deploy chop a live turn.
    const busyPath = join(dir, 'turn-active.d', '1111');
    const idlePath = join(dir, 'turn-active.d', '2222');
    const busy = createTurnBeacon({
      flagPath: busyPath,
      isTurnActive: () => true,
      intervalMs: 1000,
    });
    const idle = createTurnBeacon({
      flagPath: idlePath,
      isTurnActive: () => false,
      intervalMs: 1000,
    });

    busy.beat(true);
    idle.beat(true); // was active a moment ago...
    idle.beat(false); // ...now idle: removes its own flag only

    expect(existsSync(busyPath)).toBe(true);
    expect(existsSync(idlePath)).toBe(false);
  });

  it('distinct processes get distinct flag paths under turn-active.d', () => {
    const a = turnFlagPathForProcess('/lace', 101);
    const b = turnFlagPathForProcess('/lace', 202);
    expect(a).not.toBe(b);
    expect(a).toBe('/lace/turn-active.d/101');
    expect(b).toBe('/lace/turn-active.d/202');
  });

  it('never throws when the flag path is unwritable', () => {
    const beacon = createTurnBeacon({
      flagPath: join(dir, 'no-such-subdir', 'nested', 'turn-active'),
      isTurnActive: () => true,
      intervalMs: 1000,
    });
    // Parent dirs are created on demand; deleting the root out from under it
    // must not crash the beat either.
    beacon.beat(true);
    rmSync(dir, { recursive: true, force: true });
    expect(() => beacon.beat(true)).not.toThrow();
  });
});
