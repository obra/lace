import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent jobs (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-jobs' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('spawns a shell job, streams updates, and persists output', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let jobId: string | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);
      if (p.type === 'job_started' && typeof p.jobId === 'string') jobId = p.jobId;
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async (_params) => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: echo hi' }],
      }),
      5_000,
      'session/prompt'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!jobId) return;
          const finished = updates.find((u) => u.type === 'job_finished' && u.jobId === jobId);
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'job_finished update'
    );

    expect(jobId).toMatch(/^job_/);

    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
    expect(output.output).toContain('hi');

    const list = (await withTimeout(
      ctx.agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list'
    )) as {
      jobs: Array<{ jobId: string; status: string }>;
    };

    expect(list.jobs.find((j) => j.jobId === jobId)).toMatchObject({ status: 'completed' });

    await ctx.agent.shutdown();
    ctx.agent = undefined;

    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );
    await withTimeout(
      ctx.agent.peer.request('session/load', {
        sessionId: created.sessionId,
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/load (restart)'
    );

    const listAfterRestart = (await withTimeout(
      ctx.agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list (restart)'
    )) as { jobs: Array<{ jobId: string; status: string }> };

    expect(listAfterRestart.jobs.find((j) => j.jobId === jobId)).toMatchObject({
      status: 'completed',
    });

    const outputAfterRestart = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output (restart)'
    )) as { status: string; output: string };

    expect(outputAfterRestart.status).toBe('completed');
    expect(outputAfterRestart.output).toContain('hi');
  });

  it('can cancel a job while it is awaiting permission', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let observedJobId: string | undefined;
    let permissionForJobId: string | undefined;
    let resolvePermission: ((decision: { decision: 'allow' | 'deny' }) => void) | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') observedJobId = p.jobId;
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async (params) => {
      const p = params as Record<string, unknown>;
      if (typeof p.jobId === 'string') permissionForJobId = p.jobId;
      return await new Promise((resolve) => {
        resolvePermission = resolve as any;
      });
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: sleep 5' }],
      }),
      5_000,
      'session/prompt'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (observedJobId && permissionForJobId === observedJobId) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'permission request for job'
    );

    const killed = (await withTimeout(
      ctx.agent.peer.request('ent/job/kill', { jobId: observedJobId }),
      2_000,
      'ent/job/kill'
    )) as { success: boolean };
    expect(killed.success).toBe(true);

    resolvePermission?.({ decision: 'allow' });

    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId: observedJobId }),
      2_000,
      'ent/job/output'
    )) as { status: string };

    expect(output.status).toBe('cancelled');
  });

  it('job record includes subagentSessionId for subagent jobs', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let subagentJobId: string | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);
      if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
        subagentJobId = p.jobId;
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'subagent: hi' }],
      }),
      10_000,
      'session/prompt'
    );

    // Wait for job_finished to ensure subagent session was created
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!subagentJobId) return;
          const finished = updates.find(
            (u) => u.type === 'job_finished' && u.jobId === subagentJobId
          );
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'job_finished update'
    );

    expect(subagentJobId).toMatch(/^job_/);

    // Get job list and verify subagentSessionId is present
    const list = (await withTimeout(
      ctx.agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list'
    )) as {
      jobs: Array<{ jobId: string; type: string; subagentSessionId?: string }>;
    };

    const subagentJob = list.jobs.find((j) => j.jobId === subagentJobId);
    expect(subagentJob).toBeDefined();
    expect(subagentJob?.type).toBe('delegate');
    expect(subagentJob?.subagentSessionId).toBeDefined();
    expect(subagentJob?.subagentSessionId).toMatch(/^sess_/);

    // Verify persistence after restart
    await ctx.agent.shutdown();
    ctx.agent = undefined;

    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );
    await withTimeout(
      ctx.agent.peer.request('session/load', {
        sessionId: created.sessionId,
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/load (restart)'
    );

    const listAfterRestart = (await withTimeout(
      ctx.agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list (restart)'
    )) as { jobs: Array<{ jobId: string; type: string; subagentSessionId?: string }> };

    const jobAfterRestart = listAfterRestart.jobs.find((j) => j.jobId === subagentJobId);
    expect(jobAfterRestart?.subagentSessionId).toBeDefined();
    expect(jobAfterRestart?.subagentSessionId).toMatch(/^sess_/);
  });
});
