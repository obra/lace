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
import type { JobState } from '@lace/agent/server-types';
import type { ToolContext } from '../../types';

describe('job_kill destroy_container', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-jobkill-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  function setup(jobStatus: 'running' | 'completed', parentId = 'sess_parent') {
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

    const job = { jobId: 'job_x', status: jobStatus, subagentSessionId: childId } as JobState;
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
    const { calls, reaper, parentId, childId, jobManager, tool } = setup('completed');
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
    const { calls, childId, jobManager, tool, reaper, parentId } = setup('running');
    const result = await tool.execute(
      { jobId: 'job_x', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: parentId })
    );
    expect(result.status).toBe('completed');
    expect(calls[0]).toBe('cancelJob');
    expect(calls).toContain(`release:${childId}:spec-child`);
  });

  it('does NOT tear down a workspace owned by another session', async () => {
    const { releasePerInvocation, dir, jobManager, tool, reaper } = setup('completed');
    const result = await tool.execute(
      { jobId: 'job_x', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: 'sess_other' })
    );
    expect(result.status).toBe('completed'); // the kill still "succeeds"
    expect(releasePerInvocation).not.toHaveBeenCalled(); // cross-session: untouched
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('plain kill (destroy_container=false) leaves the delegation tracked', async () => {
    const { releasePerInvocation, dir, jobManager, tool, reaper, parentId } = setup('running');
    const result = await tool.execute(
      { jobId: 'job_x' },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: parentId })
    );
    expect(result.status).toBe('completed');
    expect(releasePerInvocation).not.toHaveBeenCalled();
    expect(fs.existsSync(dir)).toBe(true); // resumable: workspace preserved
    expect(reaper.get('sess_child')).toBeDefined();
  });

  it('destroy_container on an unknown job fails', async () => {
    const reaper = new WorkspaceReaper();
    const jobManager = { getJob: vi.fn().mockReturnValue(undefined) } as unknown as JobManager;
    const result = await new JobKillTool().execute(
      { jobId: 'nope', destroy_container: true },
      ctx({ jobManager, workspaceReaper: reaper, activeSessionId: 'sess_parent' })
    );
    expect(result.status).toBe('failed');
  });
});
