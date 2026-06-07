// ABOUTME: Tests for DelegateTool - subagent job creation via JobManager

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DelegateTool } from '../delegate';
import { isSessionId } from '@lace/ent-protocol';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type {
  EnvironmentRegistry,
  EnvironmentRuntime,
} from '@lace/agent/config/environment-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

// A role persona now references an environment by name; the container spec is
// resolved from the environment registry. These helpers build the matching pair
// of fakes so the delegate tests drive the real role→environment resolution.
function rolePersona(environmentName: string, model?: string): unknown {
  return {
    config: {
      ...(model ? { model } : {}),
      runtime: { type: 'container', environment: environmentName },
    },
    body: 'role body',
  };
}

function fakePersonaRegistry(environmentName: string, model?: string): PersonaRegistry {
  return {
    parsePersona: vi.fn().mockReturnValue(rolePersona(environmentName, model)),
    listAvailablePersonas: vi.fn().mockReturnValue([]),
  } as unknown as PersonaRegistry;
}

function fakeEnvironmentRegistry(byName: Record<string, EnvironmentRuntime>): EnvironmentRegistry {
  return {
    parseEnvironment: vi.fn((name: string) => {
      const runtime = byName[name];
      if (!runtime) throw new Error(`no fake environment '${name}'`);
      return { runtime };
    }),
    listAvailable: vi.fn().mockReturnValue(Object.keys(byName)),
  } as unknown as EnvironmentRegistry;
}

const PER_INVOCATION_RT: EnvironmentRuntime = {
  type: 'container',
  containerSharing: 'per_invocation',
  image: 'example/subagent:latest',
  workingDirectory: '/workspace',
  mounts: [],
  env: {},
};

describe('DelegateTool', () => {
  const runtimeBinding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'rt_delegate_host' },
    toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
  };

  // Temp dir used as LACE_WORK_DIR for tests that exercise scratch dir creation.
  let scratchBase: string;
  let originalLaceWorkDir: string | undefined;

  beforeEach(() => {
    scratchBase = fs.mkdtempSync(path.join(tmpdir(), 'lace-d3-test-'));
    originalLaceWorkDir = process.env.LACE_WORK_DIR;
    process.env.LACE_WORK_DIR = scratchBase;
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

  it("drives the shim by the role's environment, not the role name", async () => {
    // role 'persistent-box-worker' references environment 'persistent-box'.
    // The created job's containerSpec / selector must carry 'persistent-box'.
    const personaRegistry = fakePersonaRegistry('persistent-box');
    const environmentRegistry = fakeEnvironmentRegistry({
      'persistent-box': {
        type: 'container',
        containerSharing: 'persistent',
        image: 'sen-persistent-box:dev',
        workingDirectory: '/home/sen',
        mounts: [],
        env: {},
      },
    });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

    const mockJob = {
      jobId: 'job_env_keyed',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_env_keyed', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'do something', background: true, persona: 'persistent-box-worker' },
      { signal: new AbortController().signal, jobManager, runtimeBinding }
    );

    const jobOptions = createJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(jobOptions.containerSharing).toBe('persistent');
    // selector / spec name carries the ENVIRONMENT, never the role name
    expect(JSON.stringify(jobOptions)).toContain('persistent-box');
    expect(JSON.stringify(jobOptions)).not.toContain('persistent-box-worker-');
    const binding = jobOptions.runtimeBinding as RuntimeExecutionBinding;
    expect(
      (
        binding.toolRuntime as Extract<
          RuntimeExecutionBinding['toolRuntime'],
          { type: 'container' }
        >
      ).spec
    ).toMatchObject({ name: 'persistent-box', persona: 'persistent-box' });
  });

  it('passes projected runtimeBinding for host-placed session-lifecycle container personas', async () => {
    const personaRegistry = fakePersonaRegistry('container-persona');
    const environmentRegistry = fakeEnvironmentRegistry({
      'container-persona': {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'example/subagent@sha256:' + 'a'.repeat(64),
        workingDirectory: '/workspace',
        mounts: [],
        env: {},
      },
    });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
    expect(options.runtimeBinding).toMatchObject({
      toolRuntime: { type: 'container', cwd: '/workspace' },
    });
  });

  it('passes tag-only persona images through verbatim (no pre-resolution)', async () => {
    const personaRegistry = fakePersonaRegistry('tag-only');
    const environmentRegistry = fakeEnvironmentRegistry({
      'tag-only': {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'sen-box:dev',
        workingDirectory: '/workspace',
        mounts: [],
        env: {},
      },
    });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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

  it('passes projected runtimeBinding for persistent container personas', async () => {
    const personaRegistry = fakePersonaRegistry('box-shell');
    const environmentRegistry = fakeEnvironmentRegistry({
      'box-shell': {
        type: 'container',
        containerSharing: 'persistent',
        image: 'example/sen-box@sha256:' + 'a'.repeat(64),
        workingDirectory: '/home/agent',
        mounts: [],
        env: {},
      },
    });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
    expect((options.runtimeBinding as RuntimeExecutionBinding).toolRuntime).toMatchObject({
      type: 'container',
      spec: { name: 'box-shell', persona: 'box-shell' },
    });
    const containerRuntime = (options.runtimeBinding as RuntimeExecutionBinding)
      .toolRuntime as Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>;
    expect(containerRuntime.spec.containerId).toBe('sen-box-shell');
    expect(containerRuntime.spec.restartPolicy).toBe('unless-stopped');
  });

  it('uses containerMounts from context when building projected binding', async () => {
    const personaRegistry = fakePersonaRegistry('mounts-persona');
    const environmentRegistry = fakeEnvironmentRegistry({
      'mounts-persona': {
        type: 'container',
        // Use persistent so we can test a named mount without triggering
        // the 'scratch' reservation error for per_invocation.
        containerSharing: 'persistent',
        image: 'example/subagent@sha256:' + 'a'.repeat(64),
        workingDirectory: '/work',
        mounts: ['data'],
        env: {},
      },
    });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
        containerMounts: {
          data: { hostPath: '/host/data', containerPath: '/work', readonly: false },
        },
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
  // per_invocation response shape tests
  // ---------------------------------------------------------------------------

  it('background per_invocation response includes subagentSessionId and scratchDir', async () => {
    const personaRegistry = fakePersonaRegistry('inv-persona');
    const environmentRegistry = fakeEnvironmentRegistry({ 'inv-persona': PER_INVOCATION_RT });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
    // #5: the result returns the workspace path (framed untrusted), in the
    // shared results tree at <base>/<parentId>/<childId>, not <base>/<childId>.
    expect(typeof body.workspace).toBe('string');
    const expectedScratchDir = path.join(
      scratchBase,
      'sess_parent123',
      body.subagentSessionId as string
    );
    expect(body.workspace).toBe(expectedScratchDir);
    expect(body.workspaceNote).toContain('UNTRUSTED');
    expect(body.workspaceNote).toContain('INCOMPLETE'); // background → still running
    expect(body.workspaceNote).toContain('job_kill');
    // lace no longer mkdirs /work — the shim provisions it at spawn. lace only
    // computes the host path for the result + tracking.
  });

  it('sync per_invocation preamble includes scratchDir', async () => {
    const personaRegistry = fakePersonaRegistry('inv-persona');
    const environmentRegistry = fakeEnvironmentRegistry({ 'inv-persona': PER_INVOCATION_RT });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
    expect(text).toMatch(/^delegate jobId=job_sync_inv/);
    expect(text).toContain('Subagent workspace:');
    expect(text).toContain('UNTRUSTED');
    expect(text).toContain('job_kill');
  });

  it('resume reuses prior subagent session id and scratch dir for per_invocation', async () => {
    const personaRegistry = fakePersonaRegistry('inv-persona');
    const environmentRegistry = fakeEnvironmentRegistry({ 'inv-persona': PER_INVOCATION_RT });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
    const mintedScratchDir = firstBody.workspace as string;
    expect(mintedSessionId.startsWith('sess_')).toBe(true);

    // Simulate the shim having provisioned /work and the child having produced
    // output — resume requires a non-empty workspace (the empty-workspace gate
    // refuses a hollow resurrection).
    fs.mkdirSync(mintedScratchDir, { recursive: true });
    fs.writeFileSync(path.join(mintedScratchDir, 'out.txt'), 'prior output');

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
    expect(secondBody.workspace).toBe(mintedScratchDir);
  });

  it('persistent persona background response omits subagentSessionId and scratchDir', async () => {
    const personaRegistry = fakePersonaRegistry('box-shell');
    const environmentRegistry = fakeEnvironmentRegistry({
      'box-shell': {
        type: 'container',
        containerSharing: 'persistent',
        image: 'example/sen-box:latest',
        workingDirectory: '/home/agent',
        mounts: [],
        env: {},
      },
    });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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
    expect(body.workspace).toBeUndefined();
  });

  it('per_invocation resume: createJob receives resumeSessionId, NOT newSubagentSessionId', async () => {
    const personaRegistry = fakePersonaRegistry('inv-persona');
    const environmentRegistry = fakeEnvironmentRegistry({ 'inv-persona': PER_INVOCATION_RT });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

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

    // Resume requires a non-empty prior workspace (empty-workspace gate).
    const priorWs = path.join(scratchBase, 'sess_parent', 'sess_abc123xyz');
    fs.mkdirSync(priorWs, { recursive: true });
    fs.writeFileSync(path.join(priorWs, 'out.txt'), 'prior output');

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
  // minted childSessionId must satisfy SessionIdSchema (hyphenated UUID)
  // ---------------------------------------------------------------------------
  it('mints childSessionId in SessionIdSchema format (hyphenated UUID)', async () => {
    const personaRegistry = fakePersonaRegistry('inv-persona');
    const environmentRegistry = fakeEnvironmentRegistry({ 'inv-persona': PER_INVOCATION_RT });
    const tool = new DelegateTool({ personaRegistry, environmentRegistry });

    const mockJob = {
      jobId: 'job_uuid_check',
      type: 'delegate' as const,
      status: 'running' as const,
      completion: new Promise<void>(() => {}),
    } as unknown as JobState;

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_uuid_check', job: mockJob });
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
        activeSessionId: 'sess_parent_uuid_test',
      }
    );

    expect(result.status).toBe('completed');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    const mintedId = body.subagentSessionId as string;
    // Must satisfy the SessionIdSchema regex: sess_<uuid> with hyphens
    expect(isSessionId(mintedId)).toBe(true);
  });

  // The per-delegate-call mount-conflict rejection moved OUT of delegate under
  // Part A: a role no longer carries mounts, so the R6 invariant is an
  // environment-pair property checked at boot via assertNoEnvironmentMountConflict
  // (covered in persona-mount-conflict.test.ts). delegate no longer runs a
  // per-call mount-conflict check, so there is no delegate-level test for it.
});
