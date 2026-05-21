// ABOUTME: E2E tests for the complete async job workflow
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readDurableEvents } from '../storage/event-log';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('async job workflow (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-async-workflow' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('persists runtimeBinding on shell job_started events', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let jobId: string | undefined;
    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });
    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', {
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: echo runtime-binding' }],
      }),
      5_000,
      'session/prompt'
    );

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
      'job_started'
    );

    const sessionDir = join(ctx.laceDir, 'agent-sessions', created.sessionId);
    const { events } = readDurableEvents(sessionDir, {
      afterEventSeq: 0,
      limit: 100,
      types: ['job_started'],
    });
    const jobStarted = events.find((event) => event.data.jobId === jobId);

    expect(jobStarted?.data).toMatchObject({
      runtimeBinding: {
        schemaVersion: 1,
        agentPlacement: 'host',
        toolRuntime: { type: 'local' },
      },
    });
  });

  it(
    'complete async bash workflow: spawn, list, check output, kill',
    { timeout: 30_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: Array<Record<string, unknown>> = [];
      let shellJobId: string | undefined;

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && p.jobType === 'bash' && typeof p.jobId === 'string') {
          shellJobId = p.jobId;
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // Spawn a long-running job that we can kill
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
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
        ctx.agent.peer.request('ent/job/list'),
        2_000,
        'ent/job/list'
      )) as { jobs: Array<{ jobId: string; status: string }> };

      const runningJob = list.jobs.find((j) => j.jobId === shellJobId);
      expect(runningJob?.status).toBe('running');

      // Kill the job
      const killed = (await withTimeout(
        ctx.agent.peer.request('ent/job/kill', { jobId: shellJobId }),
        2_000,
        'ent/job/kill'
      )) as { success: boolean };

      expect(killed.success).toBe(true);

      // Check final status
      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: shellJobId }),
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
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: Array<Record<string, unknown>> = [];
      const jobIds: string[] = [];

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && typeof p.jobId === 'string') {
          jobIds.push(p.jobId as string);
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // Spawn multiple jobs
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: sleep 30' }],
        }),
        5_000,
        'session/prompt (job 1)'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: sleep 30' }],
        }),
        5_000,
        'session/prompt (job 2)'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
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
        ctx.agent.peer.request('ent/job/list'),
        2_000,
        'ent/job/list'
      )) as { jobs: Array<{ jobId: string; status: string }> };

      const runningJobs = list.jobs.filter((j) => j.status === 'running');
      expect(runningJobs).toHaveLength(3);

      // Kill all jobs
      for (const jobId of jobIds) {
        const killed = (await withTimeout(
          ctx.agent.peer.request('ent/job/kill', { jobId }),
          2_000,
          `ent/job/kill (${jobId})`
        )) as { success: boolean };
        expect(killed.success).toBe(true);
      }

      // Verify all are cancelled
      const finalList = (await withTimeout(
        ctx.agent.peer.request('ent/job/list'),
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
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: Array<Record<string, unknown>> = [];
      let jobId: string | undefined;

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && typeof p.jobId === 'string') {
          jobId = p.jobId;
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // Spawn a job that produces output
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
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
        ctx.agent.peer.request('ent/job/output', { jobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
      expect(output.output).toContain('hello world');
    }
  );

  it('job persistence: jobs survive agent restart', { timeout: 30_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let jobId: string | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };
    const sessionId = created.sessionId;

    // Run a quick job
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
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
      ctx.agent.peer.request('ent/job/output', { jobId, block: true, timeout: 5000 }),
      6_000,
      'ent/job/output (before restart)'
    )) as { status: string; output: string };

    expect(outputBefore.status).toBe('completed');
    expect(outputBefore.output).toContain('test');

    // Shutdown and restart
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
      ctx.agent.peer.request('session/load', { sessionId, cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/load (restart)'
    );

    // Verify job still exists and has same output
    const listAfterRestart = (await withTimeout(
      ctx.agent.peer.request('ent/job/list'),
      2_000,
      'ent/job/list (restart)'
    )) as { jobs: Array<{ jobId: string; status: string }> };

    const jobAfterRestart = listAfterRestart.jobs.find((j) => j.jobId === jobId);
    expect(jobAfterRestart).toBeDefined();
    expect(jobAfterRestart?.status).toBe('completed');

    const outputAfterRestart = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output (restart)'
    )) as { status: string; output: string };

    expect(outputAfterRestart.output).toContain('test');
  });

  it('job error handling: job with non-zero exit code', { timeout: 30_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let jobId: string | undefined;
    let jobFinished = false;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      if (p.type === 'job_finished' && p.jobId === jobId) {
        jobFinished = true;
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // Spawn a job that fails
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: false' }],
      }),
      5_000,
      'session/prompt (failing job)'
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
      5_000,
      'job started'
    );

    expect(jobId).toMatch(/^job_/);

    // Wait for job to finish
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (jobFinished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'job finished'
    );

    // Check that job is marked as having failed
    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; exitCode?: number };

    expect(output.status).toBe('failed');
    // false command exits with status 1
    expect(output.exitCode).toBe(1);
  });

  it('session switch kills running jobs', { timeout: 30_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let jobId: string | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    // Create first session and start a long-running job
    const session1 = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new (1)'
    )) as { sessionId: string };
    const session1Id = session1.sessionId;

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: sleep 60' }],
      }),
      5_000,
      'session/prompt (start job)'
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

    // Switch to a new session
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new (2)'
    );

    // Load back the first session and check job status
    await withTimeout(
      ctx.agent.peer.request('session/load', {
        sessionId: session1Id,
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/load'
    );

    // Job should have been killed (cancelled status)
    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId }),
      2_000,
      'ent/job/output'
    )) as { status: string };

    expect(output.status).toBe('cancelled');
  });

  it(
    'injects completion notification when background job finishes',
    { timeout: 30_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      let jobId: string | undefined;
      const updates: Array<Record<string, unknown>> = [];

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && typeof p.jobId === 'string') {
          jobId = p.jobId;
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // Start a quick job that will complete
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: echo "test output"' }],
        }),
        5_000,
        'session/prompt (start job)'
      );

      // Wait for job to complete
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

      // Send another prompt - the notification should be injected
      // The prompt will fail because no provider is configured, but the notification
      // is injected before provider creation, so it will be in the events
      try {
        await withTimeout(
          ctx.agent.peer.request('session/prompt', {
            content: [{ type: 'text', text: 'What was the previous output?' }],
          }),
          10_000,
          'session/prompt (check notification)'
        );
      } catch {
        // Expected - no provider configured
      }

      // Verify the session events show the notification was injected
      const events = (await withTimeout(
        ctx.agent.peer.request('ent/session/events', { limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ type: string; data?: Record<string, unknown> }> };

      // Find a context_injected event carrying the notification block.
      const injectedNotification = events.events.find(
        (e) =>
          e.type === 'context_injected' &&
          Array.isArray(e.data?.content) &&
          (e.data?.content as Array<{ type: string; text?: string }>).some(
            (c) =>
              c.type === 'text' &&
              typeof c.text === 'string' &&
              c.text.includes('<notification kind="job-')
          )
      );

      expect(injectedNotification).toBeDefined();
    }
  );

  it('injects failure notification when background job fails', { timeout: 30_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let jobId: string | undefined;
    const updates: Array<Record<string, unknown>> = [];

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);
      if (p.type === 'job_started' && typeof p.jobId === 'string') {
        jobId = p.jobId;
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'allow' };
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'allow' } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // Start a job that will fail
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'job: exit 1' }],
      }),
      5_000,
      'session/prompt (start failing job)'
    );

    // Wait for job to complete (fail)
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

    // Send another prompt to trigger notification injection
    // The prompt will fail because no provider is configured, but the notification
    // is injected before provider creation
    try {
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'What happened?' }],
        }),
        10_000,
        'session/prompt (check notification)'
      );
    } catch {
      // Expected - no provider configured
    }

    // Verify the notification was injected with 'failed' type
    const events = (await withTimeout(
      ctx.agent.peer.request('ent/session/events', { limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ type: string; data?: Record<string, unknown> }> };

    const injectedFailureNotification = events.events.find(
      (e) =>
        e.type === 'context_injected' &&
        Array.isArray(e.data?.content) &&
        (e.data?.content as Array<{ type: string; text?: string }>).some(
          (c) =>
            c.type === 'text' &&
            typeof c.text === 'string' &&
            c.text.includes('<notification kind="job-failed"')
        )
    );

    expect(injectedFailureNotification).toBeDefined();
  });

  it(
    'automatically triggers a turn when job completes and agent is idle',
    { timeout: 30_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      let jobId: string | undefined;
      const updates: Array<Record<string, unknown>> = [];
      const turnStarts: string[] = [];

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && typeof p.jobId === 'string') {
          jobId = p.jobId;
        }
        if (p.type === 'turn_start' && typeof p.turnId === 'string') {
          turnStarts.push(p.turnId);
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => {
        return { decision: 'allow' };
      });

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // Start a quick background job - this triggers the first turn
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'job: echo "quick output"' }],
        }),
        5_000,
        'session/prompt (start job)'
      );

      // Record the initial turn ID
      const initialTurnId = turnStarts[0];
      expect(initialTurnId).toBeDefined();

      // Wait for job to finish
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

      // The agent should automatically trigger a new turn to process the notification
      // Wait for a second turn_start (different from the initial one)
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            // Look for a turn_start that's different from the initial turn
            if (turnStarts.length > 1 && turnStarts[turnStarts.length - 1] !== initialTurnId) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        5_000,
        'auto-triggered turn_start'
      );

      // Verify a second turn was started (for processing the notification)
      expect(turnStarts.length).toBeGreaterThanOrEqual(2);
      expect(turnStarts[turnStarts.length - 1]).not.toBe(initialTurnId);
    }
  );
});
