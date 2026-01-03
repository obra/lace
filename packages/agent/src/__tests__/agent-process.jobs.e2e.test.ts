import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';

describe('lace-agent jobs (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-jobs-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-jobs-e2e-wd-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('spawns a shell job, streams updates, and persists output', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let jobId: string | undefined;

    agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);
      if (p.type === 'job_started' && typeof p.jobId === 'string') jobId = p.jobId;
      return undefined;
    });

    agent.peer.onRequest('session/request_permission', async (_params) => {
      return { decision: 'allow' };
    });

    await withTimeout(
      agent.peer.request('initialize', {
        protocolVersion: '1.0',
        config: { approvalMode: 'ask' },
      }),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      agent.peer.request('session/prompt', {
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
      agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
    expect(output.output).toContain('hi');

    const list = (await withTimeout(agent.peer.request('ent/job/list'), 2_000, 'ent/job/list')) as {
      jobs: Array<{ jobId: string; status: string }>;
    };

    expect(list.jobs.find((j) => j.jobId === jobId)).toMatchObject({ status: 'completed' });

    await agent.shutdown();
    agent = undefined;

    agent = spawnAgentProcess({ laceDir });
    agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      agent.peer.request('initialize', { protocolVersion: '1.0' }),
      2_000,
      'initialize (restart)'
    );
    await withTimeout(
      agent.peer.request('session/load', { sessionId: created.sessionId }),
      2_000,
      'session/load (restart)'
    );

    const listAfterRestart = (await withTimeout(
      agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list (restart)'
    )) as { jobs: Array<{ jobId: string; status: string }> };

    expect(listAfterRestart.jobs.find((j) => j.jobId === jobId)).toMatchObject({
      status: 'completed',
    });

    const outputAfterRestart = (await withTimeout(
      agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output (restart)'
    )) as { status: string; output: string };

    expect(outputAfterRestart.status).toBe('completed');
    expect(outputAfterRestart.output).toContain('hi');
  });

  it('can cancel a job while it is awaiting permission', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });

    let observedJobId: string | undefined;
    let permissionForJobId: string | undefined;
    let resolvePermission: ((decision: { decision: 'allow' | 'deny' }) => void) | undefined;

    agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') observedJobId = p.jobId;
      return undefined;
    });

    agent.peer.onRequest('session/request_permission', async (params) => {
      const p = params as Record<string, unknown>;
      if (typeof p.jobId === 'string') permissionForJobId = p.jobId;
      return await new Promise((resolve) => {
        resolvePermission = resolve as any;
      });
    });

    await withTimeout(
      agent.peer.request('initialize', {
        protocolVersion: '1.0',
        config: { approvalMode: 'ask' },
      }),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await withTimeout(
      agent.peer.request('session/prompt', {
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
      agent.peer.request('ent/job/kill', { jobId: observedJobId }),
      2_000,
      'ent/job/kill'
    )) as { success: boolean };
    expect(killed.success).toBe(true);

    resolvePermission?.({ decision: 'allow' });

    const output = (await withTimeout(
      agent.peer.request('ent/job/output', { jobId: observedJobId }),
      2_000,
      'ent/job/output'
    )) as { status: string };

    expect(output.status).toBe('cancelled');
  });
});
