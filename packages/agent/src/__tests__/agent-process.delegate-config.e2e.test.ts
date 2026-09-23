// ABOUTME: E2E tests for delegate tool connectionId/modelId configuration
// ABOUTME: including a persona's model+connection pair reaching the child session

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionDir, readSessionState } from '../storage/session-store';
import {
  AGENT_BOOT_TIMEOUT_MS,
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
  E2E_TEST_TIMEOUT_MS,
  SUBAGENT_JOB_TIMEOUT_MS,
} from './helpers';

describe(
  'lace-agent delegate connectionId/modelId (E2E over stdio)',
  { timeout: E2E_TEST_TIMEOUT_MS },
  () => {
    const ctx = createE2EContext({ prefix: 'lace-agent-delegate-config' });

    beforeEach(() => ctx.setup());
    afterEach(() => ctx.teardown());

    it('spawns a subagent with connectionId and modelId configuration', async () => {
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
        AGENT_BOOT_TIMEOUT_MS,
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
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
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
        SUBAGENT_JOB_TIMEOUT_MS,
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
        SUBAGENT_JOB_TIMEOUT_MS,
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
        SUBAGENT_JOB_TIMEOUT_MS,
        'job_finished update'
      );

      // Get the job output to verify it completed
      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
    });

    it('spawns a subagent with only modelId (no connectionId)', async () => {
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
        AGENT_BOOT_TIMEOUT_MS,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // Send a prompt that triggers delegate tool with just modelId
      // The test provider syntax: "subagent config=,modelId: prompt" (empty connectionId)
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'subagent config=,gpt-4o-mini: say hi' }],
        }),
        SUBAGENT_JOB_TIMEOUT_MS,
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
        SUBAGENT_JOB_TIMEOUT_MS,
        'job_finished update'
      );

      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
    });

    it('inherits connectionId/modelId from effective config when delegate provides none', async () => {
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
        AGENT_BOOT_TIMEOUT_MS,
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

      const created = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      await withTimeout(
        ctx.agent.peer.request('ent/session/configure', {
          connectionId: 'test-conn',
        }),
        2_000,
        'ent/session/configure'
      );
      await withTimeout(
        ctx.agent.peer.request('session/set_config_option', {
          sessionId: created.sessionId,
          configId: 'model',
          value: 'session-model',
        }),
        2_000,
        'session/set_config_option'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'subagent: say hi' }],
        }),
        SUBAGENT_JOB_TIMEOUT_MS,
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
        SUBAGENT_JOB_TIMEOUT_MS,
        'job_finished update'
      );

      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      expect(output.status).toBe('completed');
    });

    it('runs a persona subagent on the persona model+connection, not the parent pair', async () => {
      // The persona declares its own pair; the parent session runs on another.
      // The child session must end up on the persona's pair, which the parent
      // pushes over the real child peer via ent/session/configure and
      // session/set_config_option after applyEffectiveJobConfig.
      const personasDir = join(ctx.laceDir, 'agent-personas');
      mkdirSync(personasDir, { recursive: true });
      writeFileSync(
        join(personasDir, 'routed.md'),
        '---\nmodel: persona-model\nconnectionId: conn_persona\n---\nYou are routed.\n'
      );

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
            config: { approvalMode: 'ask', connectionId: 'conn_parent', modelId: 'parent-model' },
          })
        ),
        AGENT_BOOT_TIMEOUT_MS,
        'initialize'
      );

      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'subagent persona=routed: say hi' }],
        }),
        SUBAGENT_JOB_TIMEOUT_MS,
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
        SUBAGENT_JOB_TIMEOUT_MS,
        'job_finished update'
      );

      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string };
      expect(output.status).toBe('completed');

      const listed = (await withTimeout(
        ctx.agent.peer.request('ent/job/list', {}),
        2_000,
        'ent/job/list'
      )) as { jobs: Array<{ jobId: string; subagentSessionId?: string }> };
      const childSessionId = listed.jobs.find((j) => j.jobId === subagentJobId)?.subagentSessionId;
      expect(childSessionId).toBeDefined();

      const childConfig = readSessionState(getSessionDir(childSessionId!)).config;
      expect(childConfig).toMatchObject({ connectionId: 'conn_persona', modelId: 'persona-model' });
    });
  }
);
