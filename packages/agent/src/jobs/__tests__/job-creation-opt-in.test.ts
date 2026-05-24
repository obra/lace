// ABOUTME: PRI-1707 — coverage for the opt-in branch in
// createShellJob / createSubagentJob (the function-call path used by the
// RPC server, distinct from JobManager.createJob used by the delegate
// tool). Both paths must gate setupProgressTimer on an explicit
// progressIntervalMs; otherwise a future regression in one would silently
// reinstate the firehose for the bash-background case while delegate
// remained opt-in.

import { describe, it, expect, vi } from 'vitest';
import { createShellJob, createSubagentJob, type JobCreationDeps } from '../job-creation';
import type { JobState } from '../../server-types';

function makeDeps(overrides: Partial<JobCreationDeps> = {}): JobCreationDeps {
  const jobs = new Map<string, JobState>();
  return {
    getActiveSession: vi.fn().mockReturnValue({
      meta: { sessionId: 'sess_1' },
      dir: '/tmp/sess',
    } as unknown as ReturnType<JobCreationDeps['getActiveSession']>),
    getJobs: vi.fn().mockReturnValue(jobs),
    persistJobStartedEvent: vi.fn().mockResolvedValue(undefined),
    emitSessionUpdate: vi.fn().mockResolvedValue(undefined),
    setupProgressTimer: vi.fn(),
    runShellJobProcess: vi.fn(),
    runSubagentJobProcess: vi.fn(),
    ...overrides,
  };
}

describe('createShellJob — opt-in progress (PRI-1707)', () => {
  it('does NOT call setupProgressTimer when progressIntervalMs is unset', async () => {
    const setupProgressTimer = vi.fn();
    const deps = makeDeps({ setupProgressTimer });

    await createShellJob({ command: 'echo hi' }, deps);

    expect(setupProgressTimer).not.toHaveBeenCalled();
  });

  it('calls setupProgressTimer when progressIntervalMs is explicit', async () => {
    const setupProgressTimer = vi.fn();
    const deps = makeDeps({ setupProgressTimer });

    await createShellJob({ command: 'echo hi', progressIntervalMs: 30000 }, deps);

    expect(setupProgressTimer).toHaveBeenCalledOnce();
    const job = setupProgressTimer.mock.calls[0][0] as JobState;
    expect(job.progressIntervalMs).toBe(30000);
  });
});

describe('createSubagentJob — opt-in progress (PRI-1707)', () => {
  it('does NOT call setupProgressTimer when progressIntervalMs is unset', async () => {
    const setupProgressTimer = vi.fn();
    const deps = makeDeps({ setupProgressTimer });

    await createSubagentJob({ prompt: 'do work' }, deps);

    expect(setupProgressTimer).not.toHaveBeenCalled();
  });

  it('calls setupProgressTimer when progressIntervalMs is explicit', async () => {
    const setupProgressTimer = vi.fn();
    const deps = makeDeps({ setupProgressTimer });

    await createSubagentJob({ prompt: 'do work', progressIntervalMs: 30000 }, deps);

    expect(setupProgressTimer).toHaveBeenCalledOnce();
    const job = setupProgressTimer.mock.calls[0][0] as JobState;
    expect(job.progressIntervalMs).toBe(30000);
  });

  it('does not accept caller-supplied container execution metadata', async () => {
    const deps = makeDeps();

    await createSubagentJob(
      {
        prompt: 'do work',
        executionEnv: { SEN_AGENT_TOKEN: 'token' },
        containerExecutionMetadata: {
          tokenEnvName: 'SEN_AGENT_TOKEN',
          token: 'token',
          personaName: 'shell',
          parentSessionId: 'sess_parent',
          jobId: 'job_child',
        },
      } as Parameters<typeof createSubagentJob>[0],
      deps
    );

    const job = [...deps.getJobs().values()][0];
    expect(job.executionEnv).toBeUndefined();
    expect(job.containerExecutionMetadata).toBeUndefined();
    expect(deps.persistJobStartedEvent).toHaveBeenCalledWith(
      expect.not.objectContaining({
        containerExecutionMetadata: expect.anything(),
      })
    );
    expect(deps.emitSessionUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        containerExecutionMetadata: expect.anything(),
      }),
      undefined
    );
  });
});
