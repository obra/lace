// ABOUTME: job_kill(destroy_container=true) — tears down a per_invocation delegation (#5)
// ABOUTME: routes release through the shim; cross-session/untracked are no-ops; running jobs are cancelled first

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JobKillTool } from '../job_kill';
import { WorkspaceReaper } from '@lace/agent/jobs/workspace-reaper';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import { createFinalizeJob } from '@lace/agent/jobs/job-notifications';
import { invalidatePersonaCache } from '@lace/agent/storage/event-log';
import type { AgentServerState, JobState } from '@lace/agent/server-types';
import type { ToolContext } from '../../types';

// The finalize path loads the parent session by id, so it must be a real
// sess_<uuid>.
const PARENT = 'sess_00000000-0000-4000-8000-000000000001';

describe('job_kill destroy_container', () => {
  let prevWorkDir: string | undefined;
  let prevLaceDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    prevLaceDir = process.env.LACE_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-jobkill-test-'));
    process.env.LACE_WORK_DIR = base;
    process.env.LACE_DIR = base;
    invalidatePersonaCache();
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    if (prevLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = prevLaceDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  // A delegate job as the job runner holds it mid-run: it names its child
  // session. Completed jobs in these tests must reach 'completed' through the
  // production finalize (createFinalizeJob), never by hand-building a
  // completed record — a hand-built one can keep fields the real finalize
  // drops, which is how a finished job's container went unreleasable while
  // the tests stayed green.
  function runningDelegateJob(childId: string): JobState {
    return {
      jobId: 'job_x',
      type: 'delegate',
      status: 'running',
      subagentSessionId: childId,
      startedAt: new Date().toISOString(),
      outputPath: path.join(base, 'job_x.log'),
      finished: false,
      completion: Promise.resolve(),
      resolveCompletion: () => {},
    } as JobState;
  }

  async function completeThroughRealFinalize(job: JobState, parentId: string): Promise<void> {
    const sessionDir = path.join(base, 'agent-sessions', parentId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId: parentId,
        workDir: base,
        created: new Date().toISOString(),
        persona: 'test',
      })
    );
    const state = {
      activeSession: { meta: { sessionId: parentId }, dir: sessionDir },
    } as unknown as AgentServerState;
    const runExclusive = async <T>(work: () => Promise<T> | T): Promise<T> => work();
    const finalizeJob = createFinalizeJob(
      state,
      runExclusive,
      async () => {},
      () => {}
    );
    job.status = 'completed';
    await finalizeJob(job, { exitCode: 0 });
    expect(job.finished).toBe(true);
  }

  async function setup(jobStatus: 'running' | 'completed', parentId = PARENT) {
    const calls: string[] = [];
    const releasePerInvocation = vi.fn(async (_parent: string, child: string, spec?: string) => {
      calls.push(`release:${child}:${spec}`);
    });
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime({ releasePerInvocation } as unknown as ContainerManager);
    const childId = 'sess_child';
    const dir = path.join(base, parentId, childId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out.txt'), 'deliverable');
    reaper.track({ childId, parentId, path: dir, containerSpecName: 'spec-child' });

    const job = runningDelegateJob(childId);
    if (jobStatus === 'completed') await completeThroughRealFinalize(job, parentId);
    const cancelJob = vi.fn(async () => {
      calls.push('cancelJob');
    });
    const jobManager = { getJob: vi.fn().mockReturnValue(job), cancelJob } as unknown as JobManager;

    const tool = new JobKillTool();
    return {
      calls,
      releasePerInvocation,
      cancelJob,
      reaper,
      parentId,
      childId,
      dir,
      jobManager,
      tool,
    };
  }

  function ctx(over: Partial<ToolContext>): ToolContext {
    return { signal: new AbortController().signal, ...over } as ToolContext;
  }

  it('tears down a completed delegation: routes release through the shim', async () => {
    const { calls, reaper, parentId, childId, jobManager, tool } = await setup('completed');
    const result = await tool.execute(
      { jobId: 'job_x', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: parentId })
    );
    expect(result.status).toBe('completed');
    expect(calls).toEqual([`release:${childId}:spec-child`]); // not running → no cancelJob
    expect(reaper.get(childId)).toBeUndefined();
    expect(reaper.isReleased(childId)).toBe(true);
  });

  it('cancels a running job first, then tears it down via the shim', async () => {
    const { calls, childId, jobManager, tool, reaper, parentId } = await setup('running');
    const result = await tool.execute(
      { jobId: 'job_x', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: parentId })
    );
    expect(result.status).toBe('completed');
    expect(calls[0]).toBe('cancelJob');
    expect(calls).toContain(`release:${childId}:spec-child`);
  });

  it('does NOT tear down a workspace owned by another session', async () => {
    const { releasePerInvocation, dir, jobManager, tool, reaper } = await setup('completed');
    const result = await tool.execute(
      { jobId: 'job_x', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: 'sess_other' })
    );
    expect(result.status).toBe('completed'); // the kill still "succeeds"
    expect(releasePerInvocation).not.toHaveBeenCalled(); // cross-session: untouched
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('plain kill (destroy_container=false) leaves the delegation tracked', async () => {
    const { releasePerInvocation, dir, jobManager, tool, reaper, parentId } =
      await setup('running');
    const result = await tool.execute(
      { jobId: 'job_x' },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: parentId })
    );
    expect(result.status).toBe('completed');
    expect(releasePerInvocation).not.toHaveBeenCalled();
    expect(fs.existsSync(dir)).toBe(true); // resumable: workspace preserved
    expect(reaper.get('sess_child')).toBeDefined();
  });

  it('releases an UNTRACKED child through the shim instead of claiming no container exists', async () => {
    // The reaper is a per-process tracker. After a lace restart the entry for a
    // live container is gone — and job_kill(destroy_container) used to report
    // "no container to destroy" while that container demonstrably kept holding
    // its port (Cadence, 2026-08-01, container b08acf20). The shim's release
    // verb is idempotent, so when the job names a child session we route the
    // release regardless of tracking and let the shim decide.
    const calls: string[] = [];
    const releasePerInvocation = vi.fn(async (parent: string, child: string) => {
      calls.push(`release:${parent}:${child}`);
    });
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime({ releasePerInvocation } as unknown as ContainerManager);
    // NOT tracked: no reaper.track() call — simulates the post-restart process.
    const job = runningDelegateJob('sess_child');
    await completeThroughRealFinalize(job, PARENT);
    const jobManager = {
      getJob: vi.fn().mockReturnValue(job),
      cancelJob: vi.fn(),
    } as unknown as JobManager;

    const result = await new JobKillTool().execute(
      { jobId: 'job_x', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: PARENT })
    );
    expect(result.status).toBe('completed');
    expect(calls).toEqual([`release:${PARENT}:sess_child`]);
    expect(result.content[0].text).not.toContain('no container to destroy');
    expect(reaper.isReleased('sess_child')).toBe(true);
  });

  it('destroy_container on an unknown job fails', async () => {
    const reaper = new WorkspaceReaper();
    const jobManager = { getJob: vi.fn().mockReturnValue(undefined) } as unknown as JobManager;
    const result = await new JobKillTool().execute(
      { jobId: 'nope', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: PARENT })
    );
    expect(result.status).toBe('failed');
  });
});
