// ABOUTME: Tests for the detached-process-group tracker used by main.ts's
// ABOUTME: shutdown() to reap bash-tool command trees instead of orphaning them (PRI-3243)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  trackProcessGroup,
  trackedProcessGroupCount,
  killAllTrackedProcessGroups,
} from '../process-group-registry';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
    return false;
  }
}

describe('process-group-registry', () => {
  let tempDir: string;
  const spawned: number[] = [];

  afterEach(async () => {
    // Belt-and-suspenders: make sure no test process leaks past this file.
    for (const pid of spawned) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    spawned.length = 0;
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // The registry's tracked set is module-level state shared across every
    // test in this file. Sweep it back to empty so one test's tracked pgid
    // (now dead, thanks to the SIGKILLs above) can't leak into the next
    // test's assertions about trackedProcessGroupCount().
    await killAllTrackedProcessGroups(50);
  });

  function spawnDetached(command: string): ReturnType<typeof spawn> {
    tempDir = tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pgroup-registry-test-'));
    const child = spawn('/bin/bash', ['-c', command], {
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
    });
    if (typeof child.pid === 'number') spawned.push(child.pid);
    return child;
  }

  it('tracks a spawned group', () => {
    const child = spawnDetached('exit 0');
    expect(typeof child.pid).toBe('number');

    trackProcessGroup(child.pid!);
    expect(trackedProcessGroupCount()).toBe(1);
  });

  it('does NOT untrack a group just because the shell we spawned directly exits', async () => {
    // This is the regression found in review: `cmd &` backgrounds a grandchild that
    // outlives the shell bash.ts spawned. The old code untracked the pgid
    // as soon as the SHELL's own completion promise settled, so a live
    // background child dropped out of `tracked` the moment the shell
    // returned -- well before the child itself was done. Assert the entry
    // survives the shell's exit.
    const child = spawnDetached('(sleep 300 &) ; exit 0');
    const pid = child.pid!;
    trackProcessGroup(pid);
    expect(trackedProcessGroupCount()).toBe(1);

    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    // The shell (the pid we tracked) is gone, but its backgrounded `sleep`
    // grandchild is still alive in the same group.
    expect(isAlive(pid)).toBe(false);
    expect(trackedProcessGroupCount()).toBe(1);
  }, 10000);

  it('SIGKILLs a TERM-ignoring tracked process group instead of leaving it alive', async () => {
    // Mirrors jc's repro: a process that traps (ignores) SIGTERM must still
    // be gone after killAllTrackedProcessGroups, via the SIGKILL escalation.
    const child = spawnDetached("trap '' TERM; sleep 300");
    const pid = child.pid!;
    trackProcessGroup(pid);

    // Give the trap a moment to actually get installed before we signal it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(isAlive(pid)).toBe(true);

    const start = Date.now();
    // Use the same small grace the real shutdown() path relies on (see
    // process-group-registry.ts's module doc: it has to fit well under the
    // parent's 500ms kill-vs-SIGKILL deadline).
    await killAllTrackedProcessGroups(150);
    const elapsed = Date.now() - start;

    // A bit of grace for the SIGKILL to actually land -- the kernel
    // schedules it asynchronously, so isAlive() can observe the process as
    // still present for a few ms after the signal is sent.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(isAlive(pid)).toBe(false);
    // The whole point of the small default: this must stay well under the
    // parent's 500ms budget, not just "eventually" reap the group.
    expect(elapsed).toBeLessThan(500);
  }, 10000);

  it('removes a tracked entry once the kill sweep observes its group empty', async () => {
    const child = spawnDetached('exit 0');
    const pid = child.pid!;
    trackProcessGroup(pid);
    expect(trackedProcessGroupCount()).toBe(1);

    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    // Give the kernel a moment to actually reap the exited process so the
    // group-membership probe sees it gone.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await killAllTrackedProcessGroups(50);
    expect(trackedProcessGroupCount()).toBe(0);
  }, 10000);

  it('lazily drops an already-empty entry on the next trackProcessGroup call', async () => {
    const first = spawnDetached('exit 0');
    const firstPid = first.pid!;
    trackProcessGroup(firstPid);

    await new Promise<void>((resolve) => first.once('exit', () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Nothing has swept yet -- the registry can still see the stale entry.
    expect(trackedProcessGroupCount()).toBe(1);

    const second = spawnDetached('sleep 300');
    trackProcessGroup(second.pid!);

    // Tracking the second group opportunistically swept the first (now
    // empty) one out, so the count reflects only the live group.
    expect(trackedProcessGroupCount()).toBe(1);
  }, 10000);

  it('is a no-op when nothing is tracked', async () => {
    await expect(killAllTrackedProcessGroups(50)).resolves.toBeUndefined();
  });

  it('leaves an untracked group alone', async () => {
    // A group that was never registered must not be touched by a sweep.
    const child = spawnDetached('sleep 300');
    const pid = child.pid!;
    spawned.push(pid);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isAlive(pid)).toBe(true);

    await killAllTrackedProcessGroups(50);
    expect(isAlive(pid)).toBe(true);
  }, 10000);
});
