import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

describe('lace-agent delegate tool (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-delegate-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-delegate-e2e-wd-'));
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

  it('spawns a subagent job via delegate and returns its report', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    const updates: Array<Record<string, unknown>> = [];
    let delegateJobId: string | undefined;
    let delegateToolCompleted: Record<string, unknown> | undefined;

    agent.peer.onRequest('session/update', async (params) => {
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

    agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    await withTimeout(
      agent.peer.request('session/prompt', {
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
      agent.peer.request('ent/job/output', { jobId: delegateJobId }),
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
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      const started: Array<{ jobId: string; parentJobId?: string; jobType: string }> = [];
      const finished = new Set<string>();

      agent.peer.onRequest('session/update', async (params) => {
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

      agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      await withTimeout(
        agent.peer.request('session/prompt', {
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
});
