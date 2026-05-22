// ABOUTME: Unit test verifying that ensureAlarmSchedulerForActiveSession awaits
// the old scheduler's stop() before installing the new one (Bug 4 regression test).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureAlarmSchedulerForActiveSession } from '../server';
import { writeSessionMeta, writeSessionState } from '../storage/session-store';
import type { AgentServerState } from '../server-types';

describe('ensureAlarmSchedulerForActiveSession', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-scheduler-rebind-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('awaits stop() on the previous scheduler before installing the new one', async () => {
    // Create a minimal session directory so the scheduler can be constructed.
    const sessionsDir = join(tempDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const sessionId = 'sess_00000000-0000-0000-0000-000000000001';
    const sessionDir = join(sessionsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeSessionMeta(sessionDir, {
      sessionId,
      workDir: tempDir,
      created: new Date().toISOString(),
    });
    writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 });

    // Build a fake old scheduler whose stop() resolves only after a short delay.
    // If stop() is fire-and-forgotten, stopResolved will still be false when the
    // new scheduler is assigned; if it is awaited, stopResolved will be true.
    let stopResolved = false;
    const slowStop = vi.fn(
      (): Promise<void> =>
        new Promise((resolve) => {
          setTimeout(() => {
            stopResolved = true;
            resolve();
          }, 30);
        })
    );
    const fakeOldScheduler = {
      stop: slowStop,
      start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    } as unknown as AgentServerState['alarmScheduler'];

    const state = {
      activeSession: {
        meta: { sessionId, workDir: tempDir, created: new Date().toISOString() },
        dir: sessionDir,
        state: { nextEventSeq: 1, nextStreamSeq: 1 },
      },
      activeTurn: null,
      alarmScheduler: fakeOldScheduler,
    } as unknown as AgentServerState;

    const runExclusive = async <T>(work: () => Promise<T> | T): Promise<T> => work();
    await ensureAlarmSchedulerForActiveSession(state, { current: null }, runExclusive);

    // stop() must have been called exactly once …
    expect(slowStop).toHaveBeenCalledTimes(1);
    // … and the promise must have resolved before the new scheduler was assigned.
    expect(stopResolved).toBe(true);
    // A new scheduler must have replaced the old one.
    expect(state.alarmScheduler).not.toBe(fakeOldScheduler);
    expect(state.alarmScheduler).toBeDefined();
  });
});
