import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent subagents (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-subagent' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'spawns a subagent job and exposes its output via ent/job/output',
    { timeout: 20_000 },
    async () => {
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
      await withTimeout(ctx.agent.peer.request('session/new', { workDir: ctx.workDir }), 2_000, 'session/new');

      await withTimeout(
        ctx.agent.peer.request('session/prompt', { content: [{ type: 'text', text: 'subagent: hi' }] }),
        10_000,
        'session/prompt'
      );

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

      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
      expect(output.output).toContain('No tool result found');
    }
  );

  it('forwards subagent permission requests with jobId', { timeout: 20_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    let subagentJobId: string | undefined;
    let permissionParams: Record<string, unknown> | undefined;

    ctx.agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
        subagentJobId = p.jobId;
      }
      return undefined;
    });

    ctx.agent.peer.onRequest('session/request_permission', async (params) => {
      permissionParams = params as Record<string, unknown>;
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
    await withTimeout(ctx.agent.peer.request('session/new', { workDir: ctx.workDir }), 2_000, 'session/new');

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'subagent: run: echo hi' }],
      }),
      10_000,
      'session/prompt'
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (subagentJobId && permissionParams) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'permission request forwarded'
    );

    expect(permissionParams).toMatchObject({
      jobId: subagentJobId,
      tool: 'bash',
      resource: 'echo hi',
      toolCallId: expect.stringContaining(`${subagentJobId}:`),
    });
  });
});
