// ABOUTME: E2E tests for session metrics in ent/agent/status
// ABOUTME: Verifies tokensUsed, costUsd, and turnCount are returned correctly

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

describe('lace-agent session metrics (E2E)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-metrics-e2e-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-metrics-wd-'));
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
    'returns actual token usage in ent/agent/status after prompt',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      await withTimeout(
        agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

      // Send a prompt
      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt'
      );

      // Check status - tokensUsed should be non-zero
      // Test provider returns 100 input + 50 output = 150 tokens per turn
      const status = (await withTimeout(
        agent.peer.request('ent/agent/status'),
        2_000,
        'ent/agent/status'
      )) as { currentSession: { tokensUsed: number } };

      expect(status.currentSession.tokensUsed).toBeGreaterThan(0);
      // Test provider returns 100 input + 50 output = 150 tokens per LLM call
      // With tool use, there may be multiple calls, so just verify it's a multiple of 150
      expect(status.currentSession.tokensUsed % 150).toBe(0);
    }
  );

  it('returns actual cost in ent/agent/status after prompt', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

    // Send a prompt
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt'
    );

    // Check status - costUsd should match budgetUsedUsd
    const status = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { currentSession: { costUsd: number }; limits: { budgetUsedUsd: number } };

    expect(status.currentSession.costUsd).toBeGreaterThan(0);
    // costUsd should equal budgetUsedUsd (they represent the same thing)
    expect(status.currentSession.costUsd).toBe(status.limits.budgetUsedUsd);
  });

  it('returns turnCount in ent/agent/status after prompts', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

    // Check initial status - turnCount should be 0
    const statusBefore = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status before'
    )) as { currentSession: { turnCount: number } };

    expect(statusBefore.currentSession.turnCount).toBe(0);

    // Send first prompt
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt first'
    );

    // Check status after first prompt - turnCount should be 1
    const statusAfterFirst = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status after first'
    )) as { currentSession: { turnCount: number } };

    expect(statusAfterFirst.currentSession.turnCount).toBe(1);

    // Send second prompt
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hi' }],
      }),
      10_000,
      'session/prompt second'
    );

    // Check status after second prompt - turnCount should be 2
    const statusAfterSecond = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status after second'
    )) as { currentSession: { turnCount: number } };

    expect(statusAfterSecond.currentSession.turnCount).toBe(2);
  });
});
