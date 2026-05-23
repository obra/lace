// ABOUTME: Tests that ensureReminderSchedulerForActiveSession degrades gracefully
// ABOUTME: when the timezone is unset, per spec §1.4.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureReminderSchedulerForActiveSession } from '../server';
import type { AgentServerState } from '../server-types';

function tempSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'lace-tz-degrade-'));
}

function makeMinimalState(dir: string): AgentServerState {
  return {
    activeSession: {
      dir,
      meta: {
        sessionId: 'sess_test',
        workDir: '/tmp',
        created: new Date().toISOString(),
      },
      state: { nextEventSeq: 1, nextStreamSeq: 1 },
    },
    reminderScheduler: undefined,
    activeTurn: null,
    // The rest of AgentServerState is not accessed by ensureReminderSchedulerForActiveSession
  } as unknown as AgentServerState;
}

describe('ensureReminderSchedulerForActiveSession — TZ-unset graceful degradation', () => {
  const origTZ = process.env.TZ;
  const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

  beforeEach(() => {
    delete process.env.TZ;
    // Make Intl also return an empty string so getAgentTimezone() has nothing to fall back to.
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...origResolvedOptions.call(this), timeZone: '' } as Intl.ResolvedDateTimeFormatOptions;
    };
  });

  afterEach(() => {
    if (origTZ === undefined) delete process.env.TZ;
    else process.env.TZ = origTZ;
    Intl.DateTimeFormat.prototype.resolvedOptions = origResolvedOptions;
  });

  it('resolves without throwing when TZ is unset and leaves reminderScheduler undefined', async () => {
    const dir = tempSessionDir();
    const state = makeMinimalState(dir);

    const runPromptInternalRef = { current: null };
    const runExclusive = <T>(fn: () => Promise<T> | T): Promise<T> => Promise.resolve(fn() as T);

    // Must NOT throw — graceful degradation per spec §1.4.
    await expect(
      ensureReminderSchedulerForActiveSession(state, runPromptInternalRef, runExclusive)
    ).resolves.toBeUndefined();

    // reminderScheduler must be cleared so the tool's existing "no scheduler"
    // path can surface a clear error to the agent.
    expect(state.reminderScheduler).toBeUndefined();
  });
});
