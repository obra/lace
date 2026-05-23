// ABOUTME: Tests for DelegateTool - subagent job creation via JobManager

import { describe, it, expect, vi } from 'vitest';
import { DelegateTool } from '../delegate';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

describe('DelegateTool', () => {
  const runtimeBinding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'rt_delegate_host' },
    agentPlacement: 'host',
    toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
  };

  it('returns error when jobManager not in context', async () => {
    const tool = new DelegateTool();
    const result = await tool.execute({ prompt: 'test' }, { signal: new AbortController().signal });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('jobManager');
  });

  it('creates delegate job and waits for completion (sync mode)', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });

    const mockJob = {
      jobId: 'job_123',
      type: 'delegate' as const,
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_123', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue('subagent output here'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    // Resolve job completion immediately
    setTimeout(() => resolveJob(), 10);

    const result = await tool.execute(
      { prompt: 'do something' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        prompt: 'do something',
      })
    );
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_123');
  });

  it('returns immediately in background mode', async () => {
    const tool = new DelegateTool();

    const mockJob = {
      jobId: 'job_456',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}), // Never resolves
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_456', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'do something', background: true },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('job_456');
    expect(result.content[0].text).toContain('started');
  });

  it('resumes previous job session', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });
    const mockJob = {
      jobId: 'job_789',
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_789', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([{ jobId: 'job_prev', subagentSessionId: 'sess_sub_abc' }]),
      getJobOutput: vi.fn().mockReturnValue('resumed output'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    const result = await tool.execute(
      { prompt: 'continue', resume: 'job_prev' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        prompt: 'continue',
        resumeSessionId: 'sess_sub_abc',
      })
    );
    expect(result.status).toBe('completed');
  });

  it('passes context runtimeBinding to host delegate jobs', async () => {
    const tool = new DelegateTool();

    const mockJob = {
      jobId: 'job_runtime',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_runtime', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    expect(createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        prompt: 'do something',
        runtimeBinding,
      })
    );
  });

  it('passes projected runtimeBinding for host-placed session-lifecycle container personas', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerLifecycle: 'session',
            image: 'example/subagent@sha256:' + 'a'.repeat(64),
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'container persona',
      }),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_projected',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_projected', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true, persona: 'container-persona' },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(options.personaContainerRuntime).toBeUndefined();
    expect(options.runtimeBinding).toMatchObject({
      agentPlacement: 'host',
      toolRuntime: { type: 'container', cwd: '/workspace' },
    });
  });

  it('passes tag-only persona images through verbatim (no pre-resolution)', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerLifecycle: 'session',
            image: 'sen-box:dev',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'tag-only persona',
      }),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_tag_only',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_tag_only', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true, persona: 'tag-only' },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
    const binding = options.runtimeBinding as RuntimeExecutionBinding;
    const containerRuntime = binding.toolRuntime as Extract<
      RuntimeExecutionBinding['toolRuntime'],
      { type: 'container' }
    >;
    expect(containerRuntime.spec.image).toBe('sen-box:dev');
  });

  it('passes projected runtimeBinding for host-placed persistent-lifecycle container personas', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerLifecycle: 'persistent',
            image: 'example/sen-box@sha256:' + 'a'.repeat(64),
            workingDirectory: '/home/agent',
            mounts: {},
            env: {},
          },
        },
        body: 'persistent persona',
      }),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_persistent',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_persistent', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true, persona: 'box-shell' },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(options.personaContainerRuntime).toBeUndefined();
    expect((options.runtimeBinding as RuntimeExecutionBinding).toolRuntime).toMatchObject({
      type: 'container',
      spec: { name: 'box', containerId: 'sen-box', restartPolicy: 'unless-stopped' },
    });
  });

  it('uses containerMounts from context when building projected binding', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerLifecycle: 'session',
            image: 'example/subagent@sha256:' + 'a'.repeat(64),
            workingDirectory: '/work',
            mounts: { scratch: '/work' },
            env: {},
          },
        },
        body: 'mounts persona',
      }),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_mounts',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_mounts', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true, persona: 'mounts-persona' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
      }
    );

    const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
    const binding = options.runtimeBinding as RuntimeExecutionBinding;
    expect(
      (
        binding.toolRuntime as Extract<
          RuntimeExecutionBinding['toolRuntime'],
          { type: 'container' }
        >
      ).spec.mounts
    ).toContainEqual({
      hostPath: '/host/scratch',
      containerPath: '/work',
      readonly: false,
    });
  });

  it('keeps explicit agentPlacement=container on the in-container path', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'container',
            containerLifecycle: 'session',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'in-container persona',
      }),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_container_agent',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_container_agent', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true, persona: 'container-persona' },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    const options = createJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(options.runtimeBinding).toBeUndefined();
    expect(options.personaContainerRuntime).toMatchObject({
      type: 'container',
      agentPlacement: 'container',
      containerLifecycle: 'session',
    });
  });

  it('returns error when resume job not found', async () => {
    const tool = new DelegateTool();

    const jobManager = {
      listJobs: vi.fn().mockReturnValue([{ jobId: 'job_other' }]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'continue', resume: 'job_missing' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Cannot resume');
    expect(result.content[0].text).toContain('job_missing');
  });

  it('includes turn context when provided', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });

    const mockJob = {
      jobId: 'job_turn',
      status: 'completed' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_turn', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    await tool.execute(
      { prompt: 'task' },
      { signal: new AbortController().signal, jobManager, turnId: 'turn_abc', turnSeq: 5 }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        turnContext: { turnId: 'turn_abc', turnSeq: 5 },
      })
    );
  });

  it('passes connectionId and modelId to createJob', async () => {
    const tool = new DelegateTool();

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });

    const mockJob = {
      jobId: 'job_model',
      status: 'completed' as const,
      completion,
    } as unknown as JobState;

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job_model', job: mockJob }),
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue(''),
    } as unknown as JobManager;

    setTimeout(() => resolveJob(), 10);

    await tool.execute(
      { prompt: 'task', connectionId: 'conn_123', modelId: 'gpt-4' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        connectionId: 'conn_123',
        modelId: 'gpt-4',
      })
    );
  });
});
