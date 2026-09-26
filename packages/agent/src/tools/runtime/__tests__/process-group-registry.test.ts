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

  afterEach(() => {
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

  it('tracks a spawned group and untracks it once the completion promise settles', async () => {
    const child = spawnDetached('exit 0');
    const completion = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect(typeof child.pid).toBe('number');

    const untrack = trackProcessGroup(child.pid!, completion);
    expect(trackedProcessGroupCount()).toBe(1);

    await completion;
    // Simulate what bash.ts does: untrack once completion is known.
    untrack();
    expect(trackedProcessGroupCount()).toBe(0);
  });

  it('SIGKILLs a TERM-ignoring tracked process group instead of leaving it alive', async () => {
    // Mirrors jc's repro: a process that traps (ignores) SIGTERM must still
    // be gone after killAllTrackedProcessGroups, via the SIGKILL escalation.
    const child = spawnDetached("trap '' TERM; sleep 300");
    const pid = child.pid!;
    const completion = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    trackProcessGroup(pid, completion);

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

  it('is a no-op when nothing is tracked', async () => {
    await expect(killAllTrackedProcessGroups(50)).resolves.toBeUndefined();
  });

  it('leaves an untracked group alone', async () => {
    // A group that was never registered (e.g. already untracked after its
    // own completion) must not be touched by a later sweep.
    const child = spawnDetached('sleep 300');
    const pid = child.pid!;
    spawned.push(pid);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isAlive(pid)).toBe(true);

    await killAllTrackedProcessGroups(50);
    expect(isAlive(pid)).toBe(true);
  }, 10000);
});
