import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';
import { readSessionState } from '../storage/session-store';

describe('lace-agent delegate tool (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-delegate' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('spawns a subagent job via delegate and returns its report', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let delegateJobId: string | undefined;
    let delegateToolCompleted: Record<string, unknown> | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);

      if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
        delegateJobId = p.jobId;
      }

      if (
        p.type === 'tool_use' &&
        p.name === 'delegate' &&
        p.status === 'completed' &&
        p.result &&
        typeof p.result === 'object'
      ) {
        delegateToolCompleted = p;
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
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'delegate hi' }],
      }),
      10_000,
      'session/prompt'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!delegateJobId) return;
          const finished = updates.find(
            (u) => u.type === 'job_finished' && u.jobId === delegateJobId
          );
          if (!finished) return;
          if (!delegateToolCompleted) return;
          clearInterval(interval);
          resolve();
        }, 10);
      }),
      10_000,
      'delegate job completion'
    );

    const result = (delegateToolCompleted?.result as any) ?? {};
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n');

    expect(text).toContain(`delegate jobId=${delegateJobId}`);
    expect(text).toContain('No tool result found');

    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId: delegateJobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
    expect(output.output).toContain('No tool result found');
  });

  it(
    'flattens nested delegate subagents with correct parentJobId',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const started: Array<{ jobId: string; parentJobId?: string; jobType: string }> = [];
      const finished = new Set<string>();

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        if (
          p.type === 'job_started' &&
          typeof p.jobId === 'string' &&
          typeof p.jobType === 'string'
        ) {
          started.push({
            jobId: p.jobId,
            parentJobId: typeof p.parentJobId === 'string' ? p.parentJobId : undefined,
            jobType: p.jobType,
          });
        }
        if (p.type === 'job_finished' && typeof p.jobId === 'string') {
          finished.add(p.jobId);
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
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'delegate delegate write file nested.txt' }],
        }),
        10_000,
        'session/prompt'
      );

      const { outerJobId, innerJobId } = await withTimeout(
        new Promise<{ outerJobId: string; innerJobId: string }>((resolve) => {
          const interval = setInterval(() => {
            const subagents = started.filter((s) => s.jobType === 'delegate');
            if (subagents.length < 2) return;

            const outerJobId = subagents[0]!.jobId;
            const inner = subagents.find(
              (s) => s.jobId !== outerJobId && s.parentJobId === outerJobId
            );
            if (!inner) return;

            if (!finished.has(outerJobId)) return;
            if (!finished.has(inner.jobId)) return;

            clearInterval(interval);
            resolve({ outerJobId, innerJobId: inner.jobId });
          }, 10);
        }),
        10_000,
        'nested job completion'
      );

      expect(outerJobId).not.toBe(innerJobId);
    }
  );

  it('can resume a completed delegate job', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    let firstJobId: string | undefined;
    let resumeJobId: string | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);

      if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
        if (!firstJobId) {
          firstJobId = p.jobId;
        } else if (!resumeJobId) {
          resumeJobId = p.jobId;
        }
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
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // First delegate: ask subagent to say hello
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'delegate say hello' }],
      }),
      10_000,
      'first delegate'
    );

    // Wait for first job to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!firstJobId) return;
          const finished = updates.find((u) => u.type === 'job_finished' && u.jobId === firstJobId);
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'first job completion'
    );

    expect(firstJobId).toBeDefined();

    // Now resume that job and ask a follow-up
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: `delegate resume=${firstJobId} now say goodbye` }],
      }),
      10_000,
      'resume delegate'
    );

    // The resumed delegate should have started a new job
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!resumeJobId) return;
          const finished = updates.find(
            (u) => u.type === 'job_finished' && u.jobId === resumeJobId
          );
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'resume job completion'
    );

    expect(resumeJobId).toBeDefined();
    expect(resumeJobId).not.toBe(firstJobId);

    // Verify the resumed job got output
    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId: resumeJobId }),
      2_000,
      'ent/job/output for resumed job'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
  });

  it('can chain resumes (resume a resumed job)', { timeout: 30_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: Array<Record<string, unknown>> = [];
    const delegateJobs: string[] = [];

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      updates.push(p);

      if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
        delegateJobs.push(p.jobId);
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
    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // First delegate: ask subagent to say 1
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'delegate say 1' }],
      }),
      10_000,
      'first delegate'
    );

    // Wait for first job to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (delegateJobs.length < 1) return;
          const finished = updates.find(
            (u) => u.type === 'job_finished' && u.jobId === delegateJobs[0]
          );
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'first job completion'
    );

    // Resume the first job
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: `delegate resume=${delegateJobs[0]} say 2` }],
      }),
      10_000,
      'first resume'
    );

    // Wait for second job to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (delegateJobs.length < 2) return;
          const finished = updates.find(
            (u) => u.type === 'job_finished' && u.jobId === delegateJobs[1]
          );
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'second job completion'
    );

    // Now resume the SECOND job (the resumed job) - this was failing before the fix
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: `delegate resume=${delegateJobs[1]} say 3` }],
      }),
      10_000,
      'second resume (chained)'
    );

    // Wait for third job to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (delegateJobs.length < 3) return;
          const finished = updates.find(
            (u) => u.type === 'job_finished' && u.jobId === delegateJobs[2]
          );
          if (finished) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'third job completion'
    );

    expect(delegateJobs.length).toBe(3);
    expect(new Set(delegateJobs).size).toBe(3); // All different job IDs

    // Verify the third job completed successfully
    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId: delegateJobs[2] }),
      2_000,
      'ent/job/output for chained resume'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
  });

  it(
    'persists job_session_assigned event and exposes subagentSessionId via ent/job/list',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      let delegateJobId: string | undefined;

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
          delegateJobId = p.jobId;
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
      const sessionResult = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };
      const sessionId = sessionResult.sessionId;

      // Run a delegate
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'delegate say hi' }],
        }),
        10_000,
        'delegate prompt'
      );

      // Wait for job to complete
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(async () => {
            if (!delegateJobId) return;
            const jobs = (await ctx.agent!.peer.request('ent/job/list', {})) as {
              jobs: Array<{ jobId: string; status: string }>;
            };
            const job = jobs.jobs.find((j) => j.jobId === delegateJobId);
            if (job && job.status !== 'running') {
              clearInterval(interval);
              resolve();
            }
          }, 50);
        }),
        10_000,
        'job completion'
      );

      // Check events.jsonl for job_session_assigned
      const sessionsDir = join(ctx.laceDir, 'agent-sessions');
      const sessionDir = join(sessionsDir, sessionId);
      const eventsPath = join(sessionDir, 'events.jsonl');
      const eventsContent = readFileSync(eventsPath, 'utf8');
      const events = eventsContent
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const sessionAssignedEvent = events.find(
        (e) => e.type === 'job_session_assigned' && e.data?.jobId === delegateJobId
      );
      expect(sessionAssignedEvent).toBeDefined();
      expect(sessionAssignedEvent.data.subagentSessionId).toBeDefined();
      expect(typeof sessionAssignedEvent.data.subagentSessionId).toBe('string');

      const subagentSessionDir = join(sessionsDir, sessionAssignedEvent.data.subagentSessionId);
      expect(readSessionState(subagentSessionDir).config?.runtimeBinding).toMatchObject({
        schemaVersion: 1,
        agentPlacement: 'host',
        toolRuntime: { type: 'local', cwd: ctx.workDir },
      });

      // Verify ent/job/list returns the subagentSessionId
      const jobList = (await ctx.agent.peer.request('ent/job/list', {})) as {
        jobs: Array<{ jobId: string; subagentSessionId?: string }>;
      };
      const job = jobList.jobs.find((j) => j.jobId === delegateJobId);
      expect(job).toBeDefined();
      expect(job!.subagentSessionId).toBe(sessionAssignedEvent.data.subagentSessionId);
    }
  );
});
