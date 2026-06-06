// ABOUTME: Tests for the release_delegation tool (#5 Part 3) — ownership + dispose
// ABOUTME: cross-session/self/sibling denied; parent dispose destroys container then removes dir

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReleaseDelegationTool } from '../release_delegation';
import { WorkspaceReaper } from '@lace/agent/jobs/workspace-reaper';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { PerInvocationReaper } from '@lace/agent/jobs/per-invocation-reaper';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';
import type { ToolContext } from '../../types';

describe('ReleaseDelegationTool', () => {
  let prevWorkDir: string | undefined;
  let base: string;

  beforeEach(() => {
    prevWorkDir = process.env.LACE_WORK_DIR;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-release-test-'));
    process.env.LACE_WORK_DIR = base;
  });

  afterEach(() => {
    if (prevWorkDir === undefined) delete process.env.LACE_WORK_DIR;
    else process.env.LACE_WORK_DIR = prevWorkDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  function setup() {
    const calls: string[] = [];
    const destroy = vi.fn(async (spec: string) => {
      calls.push(`destroy:${spec}`);
    });
    const cancelReap = vi.fn((id: string) => {
      calls.push(`cancelReap:${id}`);
    });
    const reaper = new WorkspaceReaper();
    reaper.bindRuntime(
      { destroy } as unknown as ContainerManager,
      { cancelReap } as unknown as PerInvocationReaper
    );
    const parentId = 'sess_parent';
    const childId = 'sess_child';
    const dir = path.join(base, parentId, childId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out.txt'), 'result');
    reaper.track({ childId, parentId, path: dir, containerSpecName: 'spec-child' });

    const job = {
      jobId: 'job_x',
      subagentSessionId: childId,
    } as unknown as JobState;
    const jobManager = {
      listJobs: vi.fn().mockReturnValue([job]),
    } as unknown as JobManager;

    const tool = new ReleaseDelegationTool();
    return { calls, destroy, reaper, parentId, childId, dir, job, jobManager, tool };
  }

  function ctx(over: Partial<ToolContext>): ToolContext {
    return {
      signal: new AbortController().signal,
      ...over,
    } as ToolContext;
  }

  it('parent release destroys the container, then removes the dir, then marks it released', async () => {
    const { calls, reaper, parentId, childId, dir, jobManager, tool } = setup();

    const result = await tool.execute(
      { subagentSessionId: childId },
      ctx({ workspaceReaper: reaper, jobManager, activeSessionId: parentId })
    );

    expect(result.status).toBe('completed');
    expect(calls).toEqual([`cancelReap:${childId}`, 'destroy:spec-child']);
    expect(fs.existsSync(dir)).toBe(false);
    expect(reaper.get(childId)).toBeUndefined();
    expect(reaper.isReleased(childId)).toBe(true);
  });

  it('denies a cross-session release (a different session is not the owner)', async () => {
    const { reaper, childId, dir, destroy, tool } = setup();

    const result = await tool.execute(
      { subagentSessionId: childId },
      ctx({ workspaceReaper: reaper, activeSessionId: 'sess_other' })
    );

    expect(result.status).toBe('failed');
    expect(destroy).not.toHaveBeenCalled();
    expect(fs.existsSync(dir)).toBe(true);
    expect(reaper.get(childId)).toBeDefined();
  });

  it('denies a self/child release (the child is not the owning parent)', async () => {
    const { reaper, childId, dir, destroy, tool } = setup();

    // The child's own activeSessionId is its own session id, never the parent's.
    const result = await tool.execute(
      { subagentSessionId: childId },
      ctx({ workspaceReaper: reaper, activeSessionId: childId })
    );

    expect(result.status).toBe('failed');
    expect(destroy).not.toHaveBeenCalled();
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('fails for an unknown / already-released delegation', async () => {
    const { reaper, parentId, tool } = setup();
    const result = await tool.execute(
      { subagentSessionId: 'sess_nope' },
      ctx({ workspaceReaper: reaper, activeSessionId: parentId })
    );
    expect(result.status).toBe('failed');
  });

  it('fails when no workspaceReaper is in context', async () => {
    const { childId, parentId, tool } = setup();
    const result = await tool.execute(
      { subagentSessionId: childId },
      ctx({ activeSessionId: parentId })
    );
    expect(result.status).toBe('failed');
  });
});
