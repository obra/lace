// ABOUTME: Tests for maybeScheduleReapAfter helper — verifies reaper wiring in subagent-job exit paths
// ABOUTME: PRI-1796 Chunk E: schedule reap for per_invocation containers after child exits

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

describe('maybeScheduleReapAfter', () => {
  it('schedules a reap for a per_invocation job with a container binding and subagentSessionId', () => {
    const reaper = makeReaper();
    const job = makeJob({
      containerSharing: 'per_invocation',
      subagentSessionId: 'sess_abc',
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          spec: {
            name: 'spec-xyz',
            image: 'test:latest',
            workingDirectory: '/work',
            mounts: [],
          },
          cwd: '/work',
        },
      },
    });

    maybeScheduleReapAfter(job, reaper);

    expect(reaper.scheduleReap).toHaveBeenCalledOnce();
    expect(reaper.scheduleReap).toHaveBeenCalledWith('sess_abc', 'spec-xyz');
  });

  it('does NOT schedule a reap when containerSharing is persistent', () => {
    const reaper = makeReaper();
    const job = makeJob({
      containerSharing: 'persistent',
      subagentSessionId: 'sess_abc',
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          spec: {
            name: 'spec-xyz',
            image: 'test:latest',
            workingDirectory: '/work',
            mounts: [],
          },
          cwd: '/work',
        },
      },
    });

    maybeScheduleReapAfter(job, reaper);

    expect(reaper.scheduleReap).not.toHaveBeenCalled();
  });

  it('does NOT schedule a reap when containerSharing is absent', () => {
    const reaper = makeReaper();
    const job = makeJob({
      subagentSessionId: 'sess_abc',
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: { type: 'host', cwd: '/work' },
      },
    });

    maybeScheduleReapAfter(job, reaper);

    expect(reaper.scheduleReap).not.toHaveBeenCalled();
  });

  it('does NOT schedule a reap when subagentSessionId is absent', () => {
    const reaper = makeReaper();
    const job = makeJob({
      containerSharing: 'per_invocation',
      // subagentSessionId intentionally absent
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          spec: {
            name: 'spec-xyz',
            image: 'test:latest',
            workingDirectory: '/work',
            mounts: [],
          },
          cwd: '/work',
        },
      },
    });

    maybeScheduleReapAfter(job, reaper);

    expect(reaper.scheduleReap).not.toHaveBeenCalled();
  });

  it('does NOT schedule a reap when runtimeBinding is absent', () => {
    const reaper = makeReaper();
    const job = makeJob({
      containerSharing: 'per_invocation',
      subagentSessionId: 'sess_abc',
      // runtimeBinding intentionally absent
    });

    maybeScheduleReapAfter(job, reaper);

    expect(reaper.scheduleReap).not.toHaveBeenCalled();
  });

  it('does NOT schedule a reap when toolRuntime is not a container type', () => {
    const reaper = makeReaper();
    const job = makeJob({
      containerSharing: 'per_invocation',
      subagentSessionId: 'sess_abc',
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: { type: 'host', cwd: '/work' },
      },
    });

    maybeScheduleReapAfter(job, reaper);

    expect(reaper.scheduleReap).not.toHaveBeenCalled();
  });

  it('does NOT schedule a reap when reaper is undefined', () => {
    // Should not throw — safe no-op
    const job = makeJob({
      containerSharing: 'per_invocation',
      subagentSessionId: 'sess_abc',
      runtimeBinding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_test' },
        agentPlacement: 'host',
        toolRuntime: {
          type: 'container',
          spec: {
            name: 'spec-xyz',
            image: 'test:latest',
            workingDirectory: '/work',
            mounts: [],
          },
          cwd: '/work',
        },
      },
    });

    expect(() => maybeScheduleReapAfter(job, undefined)).not.toThrow();
  });
});
