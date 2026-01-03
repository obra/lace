import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';

describe('lace-agent subagents (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-subagent-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-subagent-e2e-wd-'));
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
    'spawns a subagent job and exposes its output via ent/job/output',
    { timeout: 20_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      const updates: Array<Record<string, unknown>> = [];
      let subagentJobId: string | undefined;

      agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && p.jobType === 'subagent' && typeof p.jobId === 'string') {
          subagentJobId = p.jobId;
        }
        return undefined;
      });

      agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

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
        agent.peer.request('session/prompt', { content: [{ type: 'text', text: 'subagent: hi' }] }),
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
        agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
      expect(output.output).toContain('No tool result found');
    }
  );

  it('forwards subagent permission requests with jobId', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    let subagentJobId: string | undefined;
    let permissionParams: Record<string, unknown> | undefined;

    agent.peer.onRequest('session/update', async (params) => {
      const p = params as Record<string, unknown>;
      if (p.type === 'job_started' && p.jobType === 'subagent' && typeof p.jobId === 'string') {
        subagentJobId = p.jobId;
      }
      return undefined;
    });

    agent.peer.onRequest('session/request_permission', async (params) => {
      permissionParams = params as Record<string, unknown>;
      return { decision: 'allow' };
    });

    await withTimeout(
      agent.peer.request('initialize', { protocolVersion: '1.0', config: { approvalMode: 'ask' } }),
      2_000,
      'initialize'
    );
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await withTimeout(
      agent.peer.request('session/prompt', {
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
      tool: 'shell.exec',
      resource: 'echo hi',
      toolCallId: expect.stringContaining(`${subagentJobId}:`),
    });
  });
});
