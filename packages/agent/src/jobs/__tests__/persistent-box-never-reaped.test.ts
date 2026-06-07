// ABOUTME: Canonical invariant — a persistent box is never tracked by the WorkspaceReaper (#5)
// ABOUTME: delegate only track()s per_invocation children, so a persistent box is never disposed

import { describe, it, expect, vi } from 'vitest';
import type { JobState } from '@lace/agent/server-types';
import type { WorkspaceReaper } from '../workspace-reaper';
import { DelegateTool } from '@lace/agent/tools/implementations/delegate';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { EnvironmentRegistry } from '@lace/agent/config/environment-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

describe('persistent-box is never reaped', () => {
  // delegate only track()s per_invocation children, so a persistent box is
  // never in the WorkspaceReaper map (and thus never disposed).
  it('a persistent box is never tracked by the WorkspaceReaper', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: { type: 'container', environment: 'box-shell' },
        },
        body: 'persistent persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const environmentRegistry = {
      parseEnvironment: vi.fn().mockReturnValue({
        runtime: {
          type: 'container',
          containerSharing: 'persistent',
          image: 'example/sen-box:latest',
          workingDirectory: '/home/agent',
          mounts: [],
          env: {},
        },
      }),
      listAvailable: vi.fn().mockReturnValue(['box-shell']),
    } as unknown as EnvironmentRegistry;
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
});
