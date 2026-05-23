// ABOUTME: Tests for DelegateTool - subagent job creation via JobManager

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DelegateTool } from '../delegate';
import { _resetEnsuredThisSessionForTest } from '../scratch-gc-reminder';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import type { ReminderScheduler } from '@lace/agent/reminders';

describe('DelegateTool', () => {
  const runtimeBinding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'rt_delegate_host' },
    agentPlacement: 'host',
    toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
  };

  // Temp dir used as LACE_WORK_DIR for tests that exercise scratch dir creation.
  let scratchBase: string;
  let originalLaceWorkDir: string | undefined;

  beforeEach(() => {
    scratchBase = fs.mkdtempSync(path.join(tmpdir(), 'lace-d3-test-'));
    originalLaceWorkDir = process.env.LACE_WORK_DIR;
    process.env.LACE_WORK_DIR = scratchBase;
    _resetEnsuredThisSessionForTest();
  });

  afterEach(() => {
    if (originalLaceWorkDir === undefined) {
      delete process.env.LACE_WORK_DIR;
    } else {
      process.env.LACE_WORK_DIR = originalLaceWorkDir;
    }
    fs.rmSync(scratchBase, { recursive: true, force: true });
  });

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
            containerSharing: 'per_invocation',
            image: 'example/subagent@sha256:' + 'a'.repeat(64),
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'container persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
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
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent',
      }
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
            containerSharing: 'per_invocation',
            image: 'sen-box:dev',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'tag-only persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
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
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent',
      }
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
            containerSharing: 'persistent',
            image: 'example/sen-box@sha256:' + 'a'.repeat(64),
            workingDirectory: '/home/agent',
            mounts: {},
            env: {},
          },
        },
        body: 'persistent persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
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
      spec: { name: 'box-shell', containerId: 'sen-box-shell', restartPolicy: 'unless-stopped' },
    });
  });

  it('uses containerMounts from context when building projected binding', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            // Use persistent so we can test a named mount without triggering
            // the 'scratch' reservation error for per_invocation.
            containerSharing: 'persistent',
            image: 'example/subagent@sha256:' + 'a'.repeat(64),
            workingDirectory: '/work',
            mounts: { data: '/work' },
            env: {},
          },
        },
        body: 'mounts persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
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
        containerMounts: { data: { hostPath: '/host/data', readonly: false } },
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
      hostPath: '/host/data',
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
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'in-container persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
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
      containerSharing: 'per_invocation',
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

  // ---------------------------------------------------------------------------
  // PRI-1796 per_invocation response shape tests
  // ---------------------------------------------------------------------------

  it('background per_invocation response includes subagentSessionId and scratchDir', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_per_inv',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_per_inv', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'work', background: true, persona: 'inv-persona' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent123',
      }
    );

    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.jobId).toBe('job_per_inv');
    expect(body.status).toBe('started');
    expect(typeof body.subagentSessionId).toBe('string');
    expect((body.subagentSessionId as string).startsWith('sess_')).toBe(true);
    expect(typeof body.scratchDir).toBe('string');
    const expectedScratchDir = path.join(scratchBase, body.subagentSessionId as string);
    expect(body.scratchDir).toBe(expectedScratchDir);
    // The scratch directory must exist on disk
    expect(fs.existsSync(expectedScratchDir)).toBe(true);
  });

  it('sync per_invocation preamble includes scratchDir', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });
    const mockJob = {
      jobId: 'job_sync_inv',
      type: 'delegate' as const,
      status: 'completed' as const,
      completion,
    } as unknown as JobState;
    setTimeout(() => resolveJob(), 10);

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_sync_inv', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue('subagent output'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'work', persona: 'inv-persona' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent456',
      }
    );

    expect(result.status).toBe('completed');
    const text = result.content[0].text;
    expect(text).toMatch(/^delegate jobId=job_sync_inv scratchDir=/);
  });

  it('resume reuses prior subagent session id and scratch dir for per_invocation', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob1 = {
      jobId: 'job_first',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_first', job: mockJob1 });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    // First invocation
    const firstResult = await tool.execute(
      { prompt: 'first task', background: true, persona: 'inv-persona' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent789',
      }
    );

    const firstBody = JSON.parse(firstResult.content[0].text) as Record<string, unknown>;
    const mintedSessionId = firstBody.subagentSessionId as string;
    const mintedScratchDir = firstBody.scratchDir as string;
    expect(mintedSessionId.startsWith('sess_')).toBe(true);

    // Second invocation with resume
    const mockJob2 = {
      jobId: 'job_second',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    createJob.mockResolvedValue({ jobId: 'job_second', job: mockJob2 });
    jobManager.listJobs = vi
      .fn()
      .mockReturnValue([{ jobId: 'job_first', subagentSessionId: mintedSessionId }]);

    const secondResult = await tool.execute(
      { prompt: 'continue', background: true, persona: 'inv-persona', resume: 'job_first' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent789',
      }
    );

    const secondBody = JSON.parse(secondResult.content[0].text) as Record<string, unknown>;
    expect(secondBody.subagentSessionId).toBe(mintedSessionId);
    expect(secondBody.scratchDir).toBe(mintedScratchDir);
  });

  it('persistent persona background response omits subagentSessionId and scratchDir', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'persistent',
            image: 'example/sen-box:latest',
            workingDirectory: '/home/agent',
            mounts: {},
            env: {},
          },
        },
        body: 'persistent persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_pers_bg',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_pers_bg', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'work', background: true, persona: 'box-shell' },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.jobId).toBe('job_pers_bg');
    expect(body.status).toBe('started');
    expect(body.subagentSessionId).toBeUndefined();
    expect(body.scratchDir).toBeUndefined();
  });

  it('per_invocation resume: createJob receives resumeSessionId, NOT newSubagentSessionId', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_resume_check',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_resume_check', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi
        .fn()
        .mockReturnValue([{ jobId: 'job_prev_inv', subagentSessionId: 'sess_abc123xyz' }]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'resume work', background: true, persona: 'inv-persona', resume: 'job_prev_inv' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent',
      }
    );

    const opts = createJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts.resumeSessionId).toBe('sess_abc123xyz');
    expect(opts.newSubagentSessionId).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // GC-1: After per_invocation delegate, GC reminder is scheduled
  // ---------------------------------------------------------------------------
  it('GC-1: per_invocation delegate schedules scratch GC reminder', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_gc1',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_gc1', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    // Create a temp dir for the reminder store
    const reminderDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-reminders-'));
    try {
      const { ReminderScheduler } = await import('@lace/agent/reminders');
      const reminderScheduler = new ReminderScheduler({
        sessionDir: reminderDir,
        now: () => Date.now(),
        notifier: vi.fn(),
      });

      await tool.execute(
        { prompt: 'gc1 work', background: true, persona: 'inv-persona' },
        {
          signal: new AbortController().signal,
          jobManager,
          runtimeBinding,
          activeSessionId: 'sess_gc1',
          reminderScheduler,
        }
      );

      const reminders = reminderScheduler.store.list();
      const gcReminder = reminders.find((r) => r.prompt.startsWith('<scratch-gc>'));
      expect(gcReminder).toBeDefined();
      expect(gcReminder?.recurs).toEqual({ kind: 'cron', expr: '0 6 * * *' });
    } finally {
      fs.rmSync(reminderDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // GC-2: Two per_invocation delegates in the same session = exactly one reminder
  // ---------------------------------------------------------------------------
  it('GC-2: two per_invocation delegates in same session schedule exactly one GC reminder', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mkMockJob = (id: string): JobState =>
      ({
        jobId: id,
        type: 'delegate' as const,
        status: 'running' as const,
        completion: new Promise<void>(() => {}),
      }) as unknown as JobState;

    const createJob = vi
      .fn()
      .mockResolvedValueOnce({ jobId: 'job_gc2a', job: mkMockJob('job_gc2a') })
      .mockResolvedValueOnce({ jobId: 'job_gc2b', job: mkMockJob('job_gc2b') });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const reminderDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-reminders-gc2-'));
    try {
      const { ReminderScheduler } = await import('@lace/agent/reminders');
      const reminderScheduler = new ReminderScheduler({
        sessionDir: reminderDir,
        now: () => Date.now(),
        notifier: vi.fn(),
      });

      const ctx = {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_gc2',
        reminderScheduler,
      };

      await tool.execute({ prompt: 'first', background: true, persona: 'inv-persona' }, ctx);
      await tool.execute({ prompt: 'second', background: true, persona: 'inv-persona' }, ctx);

      const gcReminders = reminderScheduler.store
        .list()
        .filter((r) => r.prompt.startsWith('<scratch-gc>'));
      expect(gcReminders).toHaveLength(1);
    } finally {
      fs.rmSync(reminderDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // GC-3: Scheduler throws — delegate still succeeds
  // ---------------------------------------------------------------------------
  it('GC-3: scheduler failure does not block delegate', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'per_invocation',
            image: 'example/subagent:latest',
            workingDirectory: '/workspace',
            mounts: {},
            env: {},
          },
        },
        body: 'per_invocation persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_gc3',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_gc3', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    // Fake scheduler that throws on schedule()
    const fakeScheduler = {
      store: { list: vi.fn().mockReturnValue([]) },
      schedule: vi.fn().mockRejectedValue(new Error('scheduler unavailable')),
    } as unknown as ReminderScheduler;

    const result = await tool.execute(
      { prompt: 'gc3 work', background: true, persona: 'inv-persona' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_gc3',
        reminderScheduler: fakeScheduler,
      }
    );

    // Delegate must still succeed
    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.jobId).toBe('job_gc3');
    expect(body.status).toBe('started');
  });

  // ---------------------------------------------------------------------------
  // GC-4: Persistent persona — GC reminder NOT scheduled
  // ---------------------------------------------------------------------------
  it('GC-4: persistent persona does not schedule GC reminder', async () => {
    const personaRegistry = {
      parsePersona: vi.fn().mockReturnValue({
        config: {
          runtime: {
            type: 'container',
            agentPlacement: 'host',
            containerSharing: 'persistent',
            image: 'example/sen-box:latest',
            workingDirectory: '/home/agent',
            mounts: {},
            env: {},
          },
        },
        body: 'persistent persona',
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([]),
    } as unknown as PersonaRegistry;
    const tool = new DelegateTool({ personaRegistry });

    const mockJob = {
      jobId: 'job_gc4',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_gc4', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const fakeScheduler = {
      store: { list: vi.fn().mockReturnValue([]) },
      schedule: vi.fn(),
    } as unknown as ReminderScheduler;

    await tool.execute(
      { prompt: 'gc4 work', background: true, persona: 'box-shell' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_gc4',
        reminderScheduler: fakeScheduler,
      }
    );

    expect(fakeScheduler.schedule).not.toHaveBeenCalled();
  });

  // PRI-1796 Chunk E: reaper cancel wiring
  describe('per_invocation reaper cancel wiring', () => {
    function makePerInvocationPersonaRegistry(): PersonaRegistry {
      return {
        parsePersona: vi.fn().mockReturnValue({
          config: {
            runtime: {
              type: 'container',
              agentPlacement: 'host',
              containerSharing: 'per_invocation',
              image: 'example/subagent:latest',
              workingDirectory: '/workspace',
              mounts: {},
              env: {},
            },
          },
          body: 'per_invocation persona',
        }),
        listAvailablePersonas: vi.fn().mockReturnValue([]),
      } as unknown as PersonaRegistry;
    }

    function makeReaper() {
      return {
        scheduleReap: vi.fn(),
        cancelReap: vi.fn(),
        dispose: vi.fn(),
        hasPendingReap: vi.fn().mockReturnValue(false),
        ttlMs: 1800000,
      };
    }

    it('calls cancelReap with the fresh childSessionId on a fresh per_invocation delegate', async () => {
      const personaRegistry = makePerInvocationPersonaRegistry();
      const tool = new DelegateTool({ personaRegistry });
      const reaper = makeReaper();

      const mockJob = {
        jobId: 'job_fresh',
        type: 'delegate' as const,
        status: 'running' as const,
        completion: new Promise<void>(() => {}),
      } as unknown as JobState;

      const createJob = vi.fn().mockResolvedValue({ jobId: 'job_fresh', job: mockJob });
      const jobManager = {
        createJob,
        listJobs: vi.fn().mockReturnValue([]),
      } as unknown as JobManager;

      await tool.execute(
        { prompt: 'fresh task', background: true, persona: 'per-inv-persona' },
        {
          signal: new AbortController().signal,
          jobManager,
          runtimeBinding,
          activeSessionId: 'sess_parent',

          perInvocationReaper: reaper as any,
        }
      );

      // cancelReap must have been called with the minted childSessionId
      expect(reaper.cancelReap).toHaveBeenCalledOnce();
      const [calledSessionId] = reaper.cancelReap.mock.calls[0]!;
      expect(typeof calledSessionId).toBe('string');
      expect(calledSessionId).toMatch(/^sess_/);
    });

    it('calls cancelReap with the resumed childSessionId on a resume per_invocation delegate', async () => {
      const personaRegistry = makePerInvocationPersonaRegistry();
      const tool = new DelegateTool({ personaRegistry });
      const reaper = makeReaper();

      const existingSessionId = 'sess_existing_child';
      const mockJob = {
        jobId: 'job_resume',
        type: 'delegate' as const,
        status: 'running' as const,
        completion: new Promise<void>(() => {}),
      } as unknown as JobState;

      const createJob = vi.fn().mockResolvedValue({ jobId: 'job_resume', job: mockJob });
      const jobManager = {
        createJob,
        listJobs: vi
          .fn()
          .mockReturnValue([{ jobId: 'job_prev', subagentSessionId: existingSessionId }]),
      } as unknown as JobManager;

      await tool.execute(
        { prompt: 'resume task', background: true, persona: 'per-inv-persona', resume: 'job_prev' },
        {
          signal: new AbortController().signal,
          jobManager,
          runtimeBinding,
          activeSessionId: 'sess_parent',

          perInvocationReaper: reaper as any,
        }
      );

      // cancelReap must have been called with the PRIOR session id
      expect(reaper.cancelReap).toHaveBeenCalledOnce();
      expect(reaper.cancelReap).toHaveBeenCalledWith(existingSessionId);
    });

    it('does NOT call cancelReap when reaper is absent from context', async () => {
      const personaRegistry = makePerInvocationPersonaRegistry();
      const tool = new DelegateTool({ personaRegistry });

      const mockJob = {
        jobId: 'job_no_reaper',
        type: 'delegate' as const,
        status: 'running' as const,
        completion: new Promise<void>(() => {}),
      } as unknown as JobState;

      const createJob = vi.fn().mockResolvedValue({ jobId: 'job_no_reaper', job: mockJob });
      const jobManager = {
        createJob,
        listJobs: vi.fn().mockReturnValue([]),
      } as unknown as JobManager;

      // Should not throw when reaper is absent
      await expect(
        tool.execute(
          { prompt: 'task', background: true, persona: 'per-inv-persona' },
          {
            signal: new AbortController().signal,
            jobManager,
            runtimeBinding,
            activeSessionId: 'sess_parent',
            // perInvocationReaper intentionally absent
          }
        )
      ).resolves.not.toThrow();
    });

    it('does NOT call cancelReap for a persistent persona delegate', async () => {
      const persistentPersonaRegistry = {
        parsePersona: vi.fn().mockReturnValue({
          config: {
            runtime: {
              type: 'container',
              agentPlacement: 'host',
              containerSharing: 'persistent',
              image: 'example/sen-box:latest',
              workingDirectory: '/home/agent',
              mounts: {},
              env: {},
            },
          },
          body: 'persistent persona',
        }),
        listAvailablePersonas: vi.fn().mockReturnValue([]),
      } as unknown as PersonaRegistry;

      const tool = new DelegateTool({ personaRegistry: persistentPersonaRegistry });
      const reaper = makeReaper();

      const mockJob = {
        jobId: 'job_persistent2',
        type: 'delegate' as const,
        status: 'running' as const,
        completion: new Promise<void>(() => {}),
      } as unknown as JobState;

      const createJob = vi.fn().mockResolvedValue({ jobId: 'job_persistent2', job: mockJob });
      const jobManager = {
        createJob,
        listJobs: vi.fn().mockReturnValue([]),
      } as unknown as JobManager;

      await tool.execute(
        { prompt: 'persistent task', background: true, persona: 'box-shell' },
        {
          signal: new AbortController().signal,
          jobManager,
          runtimeBinding,

          perInvocationReaper: reaper as any,
        }
      );

      expect(reaper.cancelReap).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // PRI-1796 Chunk F: PersonaSharingViolationError propagation
  // ---------------------------------------------------------------------------
  it('delegate fails with PersonaSharingViolationError when per_invocation persona conflicts with persistent', async () => {
    // box-shell: persistent with mounts.home
    // shell: per_invocation with mounts.home (conflict!)
    const personaRegistry = {
      parsePersona: vi.fn((name: string) => {
        if (name === 'box-shell') {
          return {
            config: {
              runtime: {
                type: 'container',
                agentPlacement: 'host',
                containerSharing: 'persistent',
                image: 'img:latest',
                workingDirectory: '/home',
                mounts: { home: '/home' },
                env: {},
              },
            },
            body: 'box-shell body',
          };
        }
        // 'shell' — per_invocation with the same mount name
        return {
          config: {
            runtime: {
              type: 'container',
              agentPlacement: 'host',
              containerSharing: 'per_invocation',
              image: 'img:latest',
              workingDirectory: '/shared',
              mounts: { home: '/shared' },
              env: {},
            },
          },
          body: 'shell body',
        };
      }),
      listAvailablePersonas: vi.fn().mockReturnValue([
        { name: 'box-shell', isUserDefined: false, path: '/fake/box-shell.md' },
        { name: 'shell', isUserDefined: false, path: '/fake/shell.md' },
      ]),
    } as unknown as PersonaRegistry;

    const tool = new DelegateTool({ personaRegistry });

    const jobManager = {
      listJobs: vi.fn().mockReturnValue([]),
      createJob: vi.fn(),
    } as unknown as JobManager;

    const result = await tool.execute(
      { prompt: 'task', background: true, persona: 'shell' },
      {
        signal: new AbortController().signal,
        jobManager,
        runtimeBinding,
        activeSessionId: 'sess_parent',
      }
    );

    expect(result.status).toBe('failed');
    // The error message must name the mount and the conflicting persistent persona
    expect(result.content[0].text).toContain('home');
    expect(result.content[0].text).toContain('box-shell');
  });
});
