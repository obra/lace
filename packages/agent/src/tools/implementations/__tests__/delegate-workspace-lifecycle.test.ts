// ABOUTME: Delegate workspace lifecycle (#5 Part 3) — resume close-out + retention ceiling
// ABOUTME: resume-after-release errors; resume-after-crash (empty) errors; ceiling errors + dispose frees a slot

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DelegateTool } from '../delegate';
import { WorkspaceReaper } from '@lace/agent/jobs/workspace-reaper';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { EnvironmentRegistry } from '@lace/agent/config/environment-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import type { ToolContext } from '../../types';

function perInvocationRegistry(): PersonaRegistry {
  return {
    parsePersona: vi.fn().mockReturnValue({
      config: { runtime: { type: 'container', environment: 'inv' } },
      body: 'per_invocation persona',
    }),
    listAvailablePersonas: vi.fn().mockReturnValue([]),
  } as unknown as PersonaRegistry;
}

function perInvocationEnvRegistry(): EnvironmentRegistry {
  return {
    parseEnvironment: vi.fn().mockReturnValue({
      runtime: {
        type: 'container',
        containerSharing: 'per_invocation',
        image: 'example/subagent:latest',
        workingDirectory: '/workspace',
        mounts: [],
        env: {},
      },
    }),
    listAvailable: vi.fn().mockReturnValue(['inv']),
  } as unknown as EnvironmentRegistry;
}

const runtimeBinding = {
  schemaVersion: 1,
  identity: { runtimeId: 'rt_test' },
  toolRuntime: { type: 'host', cwd: '/tmp' },
} as unknown as RuntimeExecutionBinding;

describe('delegate workspace lifecycle', () => {
  let base: string;
  let prevWorkDir: string | undefined;
  let prevMax: string | undefined;
  let reaper: WorkspaceReaper;
  let releasePerInvocation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    prevMax = process.env.LACE_WORKSPACE_MAX_PER_PARENT;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-lifecycle-test-'));
    process.env.LACE_WORK_DIR = base;
    releasePerInvocation = vi.fn().mockResolvedValue(undefined);
    reaper = new WorkspaceReaper();
    reaper.bindRuntime({ releasePerInvocation } as unknown as ContainerManager);
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    if (prevMax === undefined) delete process.env.LACE_WORKSPACE_MAX_PER_PARENT;
    else process.env.LACE_WORKSPACE_MAX_PER_PARENT = prevMax;
    fs.rmSync(base, { recursive: true, force: true });
  });

  function makeJobManager(): { jobManager: JobManager; jobs: Array<Partial<JobState>> } {
    const jobs: Array<Partial<JobState>> = [];
    let n = 0;
    const jobManager = {
      createJob: vi.fn().mockImplementation(async () => {
        const jobId = `job_${n++}`;
        const job = {
          jobId,
          type: 'delegate',
          status: 'running',
          completion: new Promise(() => {}),
        };
        return { jobId, job };
      }),
      listJobs: vi.fn().mockImplementation(() => jobs),
    } as unknown as JobManager;
    return { jobManager, jobs };
  }

  function ctx(jobManager: JobManager, parentId: string): ToolContext {
    return {
      signal: new AbortController().signal,
      jobManager,
      runtimeBinding,
      workspaceReaper: reaper,
      activeSessionId: parentId,
    } as ToolContext;
  }

  async function freshDelegate(jobManager: JobManager, parentId: string) {
    const tool = new DelegateTool({
      personaRegistry: perInvocationRegistry(),
      environmentRegistry: perInvocationEnvRegistry(),
    });
    const result = await tool.execute(
      { prompt: 'work', persona: 'inv' },
      ctx(jobManager, parentId)
    );
    return JSON.parse(result.content[0].text) as { subagentSessionId: string; workspace: string };
  }

  it('ceiling: a fresh delegate beyond the cap fails with the remedy; dispose frees a slot', async () => {
    process.env.LACE_WORKSPACE_MAX_PER_PARENT = '2';
    const { jobManager } = makeJobManager();
    const parentId = 'sess_capparent';

    const first = await freshDelegate(jobManager, parentId);
    await freshDelegate(jobManager, parentId);
    expect(reaper.countForParent(parentId)).toBe(2);

    // Third fresh delegate exceeds the cap → fail with the precise remedy.
    const tool = new DelegateTool({
      personaRegistry: perInvocationRegistry(),
      environmentRegistry: perInvocationEnvRegistry(),
    });
    const third = await tool.execute({ prompt: 'work', persona: 'inv' }, ctx(jobManager, parentId));
    expect(third.status).toBe('failed');
    expect(third.content[0].text).toContain('job_kill');
    expect(third.content[0].text).toContain('2 workspaces retained');

    // Releasing one frees a slot → a subsequent fresh delegate succeeds.
    await reaper.dispose(first.subagentSessionId);
    expect(reaper.countForParent(parentId)).toBe(1);
    const fourth = await freshDelegate(jobManager, parentId);
    expect(fourth.subagentSessionId).toBeDefined();
    expect(reaper.countForParent(parentId)).toBe(2);
  });

  it('resume-after-release errors (released + workspace removed)', async () => {
    const { jobManager, jobs } = makeJobManager();
    const parentId = 'sess_relparent';

    const fresh = await freshDelegate(jobManager, parentId);
    // The shim provisioned /work at spawn; the child then produced output, and
    // the parent released the delegation.
    fs.mkdirSync(fresh.workspace, { recursive: true });
    fs.writeFileSync(path.join(fresh.workspace, 'out.txt'), 'done');
    jobs.push({ jobId: 'job_done', subagentSessionId: fresh.subagentSessionId });
    await reaper.dispose(fresh.subagentSessionId);

    const tool = new DelegateTool({
      personaRegistry: perInvocationRegistry(),
      environmentRegistry: perInvocationEnvRegistry(),
    });
    const result = await tool.execute(
      { prompt: 'continue', persona: 'inv', resume: 'job_done' },
      ctx(jobManager, parentId)
    );
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('released');
  });

  it('resume-after-crash errors when the workspace is present but empty', async () => {
    const { jobManager, jobs } = makeJobManager();
    const parentId = 'sess_crashparent';

    const fresh = await freshDelegate(jobManager, parentId);
    jobs.push({ jobId: 'job_crash', subagentSessionId: fresh.subagentSessionId });
    // Crash backstop: the in-memory released mark is gone, but /work is empty
    // (the shim provisioned it; no child output survived). Must NOT resurrect.
    fs.mkdirSync(fresh.workspace, { recursive: true });
    expect(fs.existsSync(fresh.workspace)).toBe(true);
    expect(fs.readdirSync(fresh.workspace)).toHaveLength(0);

    const tool = new DelegateTool({
      personaRegistry: perInvocationRegistry(),
      environmentRegistry: perInvocationEnvRegistry(),
    });
    const result = await tool.execute(
      { prompt: 'continue', persona: 'inv', resume: 'job_crash' },
      ctx(jobManager, parentId)
    );
    expect(result.status).toBe('failed');
  });
});
