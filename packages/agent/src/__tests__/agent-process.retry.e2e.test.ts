// ABOUTME: E2E tests for agent retry behavior when provider returns errors
// ABOUTME: Tests that the agent properly retries on transient errors and fails on non-retryable ones

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('agent retry behavior (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-retry' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('retries on provider rate limit error (429) and succeeds', { timeout: 30_000 }, async () => {
    // Setup: Fail first 2 calls with 429, then succeed
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_TEST_PROVIDER_FAIL_COUNT: '2',
        LACE_TEST_PROVIDER_ERROR_STATUS: '429',
      },
    });

    const updates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // Send a simple prompt - should retry and eventually succeed
    const result = (await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      }),
      25_000,
      'session/prompt with retries'
    )) as { stopReason: string; turnId: string };

    // Turn should complete successfully after retries (end_turn is normal completion)
    expect(result.stopReason).toBe('end_turn');
    expect(result.turnId).toBeDefined();
  });

  it('retries on provider temporary error (500) and succeeds', { timeout: 30_000 }, async () => {
    // Setup: Fail first call with 500, then succeed
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_TEST_PROVIDER_FAIL_COUNT: '1',
        LACE_TEST_PROVIDER_ERROR_STATUS: '500',
      },
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    const result = (await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      }),
      25_000,
      'session/prompt with retry'
    )) as { stopReason: string; turnId: string };

    // Turn should complete successfully after retry
    expect(result.stopReason).toBe('end_turn');
    expect(result.turnId).toBeDefined();
  });

  it('fails after max retries exceeded on persistent 429', { timeout: 30_000 }, async () => {
    // Setup: Always fail with 429 (more failures than max retries)
    // Use very low retry delays for faster test execution
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_TEST_PROVIDER_FAIL_COUNT: '100', // More than max retries (10)
        LACE_TEST_PROVIDER_ERROR_STATUS: '429',
        LACE_TEST_PROVIDER_RETRY_DELAY_MS: '10', // Fast retries for testing
        LACE_TEST_PROVIDER_MAX_DELAY_MS: '50',
      },
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // The prompt should fail after exhausting retries (throws JSON-RPC error)
    await expect(
      withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'hello' }],
        }),
        25_000,
        'session/prompt exhausting retries'
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining('Test provider simulated error'),
    });
  });

  it('does not retry on non-retryable errors (400)', { timeout: 15_000 }, async () => {
    // Setup: Fail with 400 (client error - not retryable)
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_TEST_PROVIDER_FAIL_COUNT: '1',
        LACE_TEST_PROVIDER_ERROR_STATUS: '400',
      },
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // Should fail immediately without retry on 400 error (throws JSON-RPC error)
    await expect(
      withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'hello' }],
        }),
        10_000,
        'session/prompt with 400 error'
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining('Test provider simulated error'),
    });
  });

  it('preserves conversation state after successful retry', { timeout: 30_000 }, async () => {
    // Setup: Fail first call with 500, then succeed
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_TEST_PROVIDER_FAIL_COUNT: '1',
        LACE_TEST_PROVIDER_ERROR_STATUS: '500',
      },
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
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
        content: [{ type: 'text', text: 'hello' }],
      }),
      25_000,
      'session/prompt with retry'
    );

    // Fetch durable events to verify correct sequencing
    const durable = (await withTimeout(
      ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

    // Verify events are properly sequenced with no duplicates
    const eventTypes = durable.events.map((e) => e.type);
    const eventSeqs = durable.events.map((e) => e.eventSeq);

    // Should have prompt, turn_start, message, turn_end in proper sequence
    expect(eventTypes).toContain('prompt');
    expect(eventTypes).toContain('turn_start');
    expect(eventTypes).toContain('turn_end');

    // Event sequences should be strictly increasing (no duplicates from retry)
    for (let i = 1; i < eventSeqs.length; i++) {
      expect(eventSeqs[i]).toBeGreaterThan(eventSeqs[i - 1]);
    }

    // Verify there's exactly one turn_start and one turn_end (no duplicate turns from retry)
    const turnStarts = eventTypes.filter((t) => t === 'turn_start');
    const turnEnds = eventTypes.filter((t) => t === 'turn_end');
    expect(turnStarts.length).toBe(1);
    expect(turnEnds.length).toBe(1);
  });
});
