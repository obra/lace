// ABOUTME: E2E tests for the complete async job workflow
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

describe('async job workflow (E2E)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-async-workflow-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-async-wd-'));
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

  it(
    'complete async bash workflow: spawn, list, check output, kill',
    { timeout: 30_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      const updates: Array<Record<string, unknown>> = [];
      let shellJobId: string | undefined;

      agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && p.jobType === 'shell' && typeof p.jobId === 'string') {
          shellJobId = p.jobId;
        }
        return undefined;
      });

      agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      // Spawn a long-running job that we can kill
      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: sleep 60' }],
        }),
        5_000,
        'session/prompt (spawn job)'
      );

      // Wait for job_started
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (shellJobId) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        3_000,
        'job_started'
      );

      expect(shellJobId).toMatch(/^job_/);

      // List jobs - should show running
      const list = (await withTimeout(
        agent.peer.request('ent/job/list'),
        2_000,
        'ent/job/list'
      )) as { jobs: Array<{ jobId: string; status: string }> };

      const runningJob = list.jobs.find((j) => j.jobId === shellJobId);
      expect(runningJob?.status).toBe('running');

      // Kill the job
      const killed = (await withTimeout(
        agent.peer.request('ent/job/kill', { jobId: shellJobId }),
        2_000,
        'ent/job/kill'
      )) as { success: boolean };

      expect(killed.success).toBe(true);

      // Check final status
      const output = (await withTimeout(
        agent.peer.request('ent/job/output', { jobId: shellJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string };

      expect(output.status).toBe('cancelled');
    }
  );

  it(
    'multiple concurrent jobs: spawn several, list all, verify statuses',
    { timeout: 30_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      const updates: Array<Record<string, unknown>> = [];
      const jobIds: string[] = [];

      agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && typeof p.jobId === 'string') {
          jobIds.push(p.jobId as string);
        }
        return undefined;
      });

      agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      // Spawn multiple jobs
      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: sleep 30' }],
        }),
        5_000,
        'session/prompt (job 1)'
      );

      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: sleep 30' }],
        }),
        5_000,
        'session/prompt (job 2)'
      );

      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: sleep 30' }],
        }),
        5_000,
        'session/prompt (job 3)'
      );

      // Wait for all jobs to be started
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (jobIds.length >= 3) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        5_000,
        'all jobs started'
      );

      expect(jobIds).toHaveLength(3);

      // List jobs - should show all three running
      const list = (await withTimeout(
        agent.peer.request('ent/job/list'),
        2_000,
        'ent/job/list'
      )) as { jobs: Array<{ jobId: string; status: string }> };

      const runningJobs = list.jobs.filter((j) => j.status === 'running');
      expect(runningJobs).toHaveLength(3);

      // Kill all jobs
      for (const jobId of jobIds) {
        const killed = (await withTimeout(
          agent.peer.request('ent/job/kill', { jobId }),
          2_000,
          `ent/job/kill (${jobId})`
        )) as { success: boolean };
        expect(killed.success).toBe(true);
      }

      // Verify all are cancelled
      const finalList = (await withTimeout(
        agent.peer.request('ent/job/list'),
        2_000,
        'ent/job/list (final)'
      )) as { jobs: Array<{ jobId: string; status: string }> };

      for (const jobId of jobIds) {
        const job = finalList.jobs.find((j) => j.jobId === jobId);
        expect(job?.status).toBe('cancelled');
      }
    }
  );

  it(
    'job completion: spawn short job, wait for completion, verify output',
    { timeout: 30_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      const updates: Array<Record<string, unknown>> = [];
      let jobId: string | undefined;

      agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && typeof p.jobId === 'string') {
          jobId = p.jobId;
        }
        return undefined;
      });

      agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      // Spawn a job that produces output
      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: echo "hello world"' }],
        }),
        5_000,
        'session/prompt'
      );

      // Wait for job_finished
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

      // Check output
      const output = (await withTimeout(
        agent.peer.request('ent/job/output', { jobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
      expect(output.output).toContain('hello world');
    }
  );

  it('job persistence: jobs survive agent restart', { timeout: 30_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });

    let jobId: string | undefined;
    let sessionId: string | undefined;

    agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });

    agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };
    sessionId = created.sessionId;

    // Run a quick job
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: echo test' }],
      }),
      5_000,
      'session/prompt'
    );

    // Wait for job to start
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (jobId) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      3_000,
      'job started'
    );

    expect(jobId).toMatch(/^job_/);

    // Wait for job to complete (blocking read)
    const outputBefore = (await withTimeout(
      agent.peer.request('ent/job/output', { jobId, block: true, timeout: 5000 }),
      6_000,
      'ent/job/output (before restart)'
    )) as { status: string; output: string };

    expect(outputBefore.status).toBe('completed');
    expect(outputBefore.output).toContain('test');

    // Shutdown and restart
    await agent.shutdown();
    agent = undefined;

    agent = spawnAgentProcess({ laceDir });
    agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );

    await withTimeout(
      agent.peer.request('session/load', { sessionId }),
      2_000,
      'session/load (restart)'
    );

    // Verify job still exists and has same output
    const listAfterRestart = (await withTimeout(
      agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list (restart)'
    )) as { jobs: Array<{ jobId: string; status: string }> };

    const jobAfterRestart = listAfterRestart.jobs.find((j) => j.jobId === jobId);
    expect(jobAfterRestart).toBeDefined();
    expect(jobAfterRestart?.status).toBe('completed');

    const outputAfterRestart = (await withTimeout(
      agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output (restart)'
    )) as { status: string; output: string };

    expect(outputAfterRestart.output).toContain('test');
  });

  it('job error handling: job with non-zero exit code', { timeout: 30_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });

    let jobId: string | undefined;

    agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });

    agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    // Spawn a job that fails
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: false' }],
      }),
      5_000,
      'session/prompt (failing job)'
    );

    // Wait for job completion
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (jobId) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'job started'
    );

    expect(jobId).toMatch(/^job_/);

    // Check that job is marked as having failed
    const output = (await withTimeout(
      agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; exitCode?: number };

    expect(output.status).toBe('failed');
    // false command exits with status 1
    expect(output.exitCode).toBe(1);
  });
});
