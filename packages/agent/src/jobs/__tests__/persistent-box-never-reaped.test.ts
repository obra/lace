// ABOUTME: Canonical invariant — persistent-box is provably NEVER reaped (#5, security model)
// ABOUTME: Three legs: (1) no container idle-reap, (2) WorkspaceReaper never tracks it, (3) sweep skips it

import { describe, it, expect, vi } from 'vitest';
import { maybeScheduleReapAfter } from '../subagent-job';
import type { JobState } from '@lace/agent/server-types';
import type { PerInvocationReaper } from '../per-invocation-reaper';
import type { WorkspaceReaper } from '../workspace-reaper';
import { DelegateTool } from '@lace/agent/tools/implementations/delegate';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

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

  // Leg 2: delegate only track()s per_invocation children, so a persistent box
  // is never in the WorkspaceReaper map (and thus never disposed).
  it('leg 2: a persistent box is never tracked by the WorkspaceReaper', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            containerSharing: 'persistent',
            image: 'example/sen-box:latest',
            workingDirectory: '/home/agent',
            mounts: [],
            env: {},
          },
        },
        body: 'persistent persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_pers',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_pers', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const track = vi.fn();
    const workspaceReaper = { track } as unknown as WorkspaceReaper;
    const runtimeBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_test' },
      toolRuntime: { type: 'host', cwd: '/tmp' },
    } as unknown as RuntimeExecutionBinding;

    const result = await tool.execute(
      { prompt: 'work', background: true, persona: 'box-shell' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        workspaceReaper,
        activeSessionId: 'sess_parent_persist',
      }
    );

    expect(result.status).toBe('completed');
    expect(track).not.toHaveBeenCalled();
  });

  // Leg 3: the crash sweep is confined to resultsBase() (disjoint from the box's
  // durable mount) and skips live-container subtrees. Lands in Part 4.
  it.todo("leg 3: the sweep never descends into a persistent box's durable mount");
});
