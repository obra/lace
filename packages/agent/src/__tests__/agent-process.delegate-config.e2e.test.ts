// ABOUTME: E2E tests for delegate tool connectionId/modelId configuration

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent delegate connectionId/modelId (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-delegate-config' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'spawns a subagent with connectionId and modelId configuration',
    { timeout: 30_000 },
    async () => {
      process.env.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG = '1';
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

      // Initialize the agent
      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );

      // Create an OpenAI connection
      const created = (await withTimeout(
        ctx.agent.peer.request('ent/connections/upsert', {
          providerId: 'openai',
          connection: { name: 'Test OpenAI Connection', config: {} },
        }),
        2_000,
        'ent/connections/upsert'
      )) as { connectionId: string };

      expect(created.connectionId).toBeDefined();

      // Submit credentials for the connection
      const credResult = (await withTimeout(
        ctx.agent.peer.request('ent/connections/credentials/submit', {
          connectionId: created.connectionId,
          values: { apiKey: 'sk-test-key-for-e2e' },
        }),
        2_000,
        'credentials/submit'
      )) as { ok: boolean };

      expect(credResult.ok).toBe(true);

      // Create a new session
      await withTimeout(
        ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
        2_000,
        'session/new'
      );

      // Test with connectionId and modelId - use simpler hardcoded values
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [
            {
              type: 'text',
              text: 'subagent config=test-conn,gpt-4o-mini: say hello',
            },
          ],
        }),
        15_000,
        'session/prompt (with config)'
      );

      // Wait for job to start
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (subagentJobId) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        10_000,
        'job_started update'
      );

      expect(subagentJobId).toBeDefined();

      // Wait for job to finish
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const finished = updates.find(
              (u) => u.type === 'job_finished' && u.jobId === subagentJobId
            );
            if (finished) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        15_000,
        'job_finished update'
      );

      // Get the job output to verify it completed
      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
    }
  );

  it('spawns a subagent with only modelId (no connectionId)', { timeout: 30_000 }, async () => {
    process.env.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG = '1';
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

    await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    );

    // Send a prompt that triggers delegate tool with just modelId
    // The test provider syntax: "subagent config=,modelId: prompt" (empty connectionId)
    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'subagent config=,gpt-4o-mini: say hi' }],
      }),
      15_000,
      'session/prompt'
    );

    // Wait for job to finish
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
      15_000,
      'job_finished update'
    );

    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
  });

  it('inherits connectionId/modelId from effective config when delegate provides none', { timeout: 30_000 }, async () => {
    process.env.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG = '1';
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
        defaultInitializeParams({
          config: { approvalMode: 'ask', connectionId: 'server-conn', modelId: 'server-model' },
        })
      ),
      2_000,
      'initialize'
    );

    // Create a connection so the strict config check can validate it exists
    await withTimeout(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId: 'openai',
        connection: { connectionId: 'test-conn', name: 'Test Connection', config: {} },
      }),
      2_000,
      'ent/connections/upsert'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    );

    await withTimeout(
      ctx.agent.peer.request('ent/session/configure', {
        connectionId: 'test-conn',
        modelId: 'session-model',
      }),
      2_000,
      'ent/session/configure'
    );

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'subagent: say hi' }],
      }),
      15_000,
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
      15_000,
      'job_finished update'
    );

    const output = (await withTimeout(
      ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
      2_000,
      'ent/job/output'
    )) as { status: string; output: string };

    expect(output.status).toBe('completed');
  });
});
