// ABOUTME: Canonical invariant — persistent-box is provably NEVER reaped (#5, security model)
// ABOUTME: Three legs: (1) no container idle-reap, (2) WorkspaceReaper never tracks it, (3) sweep skips it

import { describe, it, expect, vi } from 'vitest';
import { maybeScheduleReapAfter } from '../subagent-job';
import type { JobState } from '@lace/agent/server-types';
import type { PerInvocationReaper } from '../per-invocation-reaper';

function makeReaper(): PerInvocationReaper {
  return {
    scheduleReap: vi.fn(),
    cancelReap: vi.fn(),
    dispose: vi.fn(),
    hasPendingReap: vi.fn(),
    ttlMs: 1000,
  } as unknown as PerInvocationReaper;
}

function makeJob(overrides: Partial<JobState> = {}): JobState {
  let resolveCompletion: () => void = () => undefined;
  const completion = new Promise<void>((r) => {
    resolveCompletion = r;
  });
  return {
    jobId: 'job_test',
    type: 'delegate',
    status: 'completed',
    startedAt: new Date().toISOString(),
    outputPath: '/tmp/test.log',
    finished: true,
    completion,
    resolveCompletion,
    ...overrides,
  };
}

describe('persistent-box is never reaped', () => {
  // Leg 1: a persistent job never schedules a container idle-reap. The early
  // return on containerSharing !== 'per_invocation' is also exercised in
  // subagent-job-reaper.test.ts; asserted here as the named invariant.
  it('leg 1: a persistent job never schedules a container reap', () => {
    const reaper = makeReaper();
    const job = makeJob({ containerSharing: 'persistent', subagentSessionId: 'sess_persist' });
    maybeScheduleReapAfter(job, reaper);
    expect(reaper.scheduleReap).not.toHaveBeenCalled();
  });

  // Leg 2: delegate only track()s per_invocation children, so a persistent box is
  // never in the WorkspaceReaper map (and thus never disposed). Lands in Part 2.
  it.todo('leg 2: a persistent box is never tracked by the WorkspaceReaper');

  // Leg 3: the crash sweep is confined to resultsBase() (disjoint from the box's
  // durable mount) and skips live-container subtrees. Lands in Part 4.
  it.todo("leg 3: the sweep never descends into a persistent box's durable mount");
});
