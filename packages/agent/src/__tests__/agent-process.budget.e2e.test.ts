// ABOUTME: E2E tests for token budget tracking and enforcement
// ABOUTME: Verifies that token usage is tracked and budget limits are enforced

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

describe('lace-agent token budget tracking (E2E)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-budget-e2e-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-budget-wd-'));
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

  it('returns token usage in prompt response', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

    const promptResult = (await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt'
    )) as { turnId: string; usage: { inputTokens: number; outputTokens: number } };

    // Token usage should be returned and non-zero (test provider returns mock usage)
    expect(promptResult.usage).toBeDefined();
    expect(promptResult.usage.inputTokens).toBeGreaterThan(0);
    expect(promptResult.usage.outputTokens).toBeGreaterThan(0);
  });

  it('tracks budgetUsedUsd in agent status', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    // Configure a budget
    await withTimeout(
      agent.peer.request('ent/session/configure', { maxBudgetUsd: 10.0 }),
      2_000,
      'ent/session/configure'
    );

    // Check initial status - budgetUsedUsd should be 0
    const statusBefore = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status before'
    )) as { limits: { maxBudgetUsd?: number; budgetUsedUsd: number } };

    expect(statusBefore.limits.maxBudgetUsd).toBe(10.0);
    expect(statusBefore.limits.budgetUsedUsd).toBe(0);

    // Send a prompt
    writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt'
    );

    // Check status after - budgetUsedUsd should be > 0
    const statusAfter = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status after'
    )) as { limits: { maxBudgetUsd?: number; budgetUsedUsd: number } };

    expect(statusAfter.limits.maxBudgetUsd).toBe(10.0);
    expect(statusAfter.limits.budgetUsedUsd).toBeGreaterThan(0);
  });

  it('stops turn with budget_exceeded when budget is exhausted', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    // Configure a very small budget that will be exceeded
    await withTimeout(
      agent.peer.request('ent/session/configure', { maxBudgetUsd: 0.0001 }),
      2_000,
      'ent/session/configure'
    );

    writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

    // First prompt should work and consume budget
    const firstResult = (await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt first'
    )) as { turnId: string; stopReason: string };

    // Either the first turn exceeds budget mid-turn, or we can check a second prompt
    // The exact behavior depends on when we check - let's expect budget_exceeded
    // if budget was exceeded during this turn, or try another prompt
    if (firstResult.stopReason !== 'budget_exceeded') {
      // Try another prompt - it should fail with budget_exceeded
      const secondResult = (await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'hi' }],
        }),
        10_000,
        'session/prompt second'
      )) as { stopReason: string };

      expect(secondResult.stopReason).toBe('budget_exceeded');
    } else {
      expect(firstResult.stopReason).toBe('budget_exceeded');
    }
  });

  it(
    'continues normally when maxBudgetUsd is 0 (budget disabled)',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      await withTimeout(
        agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );

      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      // Configure budget to 0 (should disable budget enforcement)
      await withTimeout(
        agent.peer.request('ent/session/configure', { maxBudgetUsd: 0 }),
        2_000,
        'ent/session/configure'
      );

      writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

      const promptResult = (await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file hello.txt' }],
        }),
        10_000,
        'session/prompt'
      )) as { stopReason: string };

      // Should complete normally, not budget_exceeded
      expect(promptResult.stopReason).not.toBe('budget_exceeded');
    }
  );

  it('accumulates budgetUsedUsd across multiple prompts', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    // Configure a generous budget
    await withTimeout(
      agent.peer.request('ent/session/configure', { maxBudgetUsd: 100.0 }),
      2_000,
      'ent/session/configure'
    );

    writeFileSync(join(workDir, 'hello.txt'), 'hello world\n', 'utf8');

    // First prompt
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt first'
    );

    const statusAfterFirst = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status after first'
    )) as { limits: { budgetUsedUsd: number } };

    const usedAfterFirst = statusAfterFirst.limits.budgetUsedUsd;
    expect(usedAfterFirst).toBeGreaterThan(0);

    // Second prompt
    await withTimeout(
      agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file hello.txt' }],
      }),
      10_000,
      'session/prompt second'
    );

    const statusAfterSecond = (await withTimeout(
      agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status after second'
    )) as { limits: { budgetUsedUsd: number } };

    const usedAfterSecond = statusAfterSecond.limits.budgetUsedUsd;

    // Budget should have accumulated
    expect(usedAfterSecond).toBeGreaterThan(usedAfterFirst);
  });
});
