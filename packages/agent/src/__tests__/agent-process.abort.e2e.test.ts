// ABOUTME: E2E tests for agent abort handling during various operation phases.
// ABOUTME: Validates session/cancel during streaming, tool execution, and permission waits.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('agent abort reliability (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-abort' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('aborts cleanly during LLM streaming', { timeout: 15_000 }, async () => {
    // Setup: Use test provider with streaming delay to give us time to cancel
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_TEST_PROVIDER_STREAM_DELAY_MS: '2000', // 2 second delay before response
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

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Start a prompt (will be delayed by streaming delay)
    const { result: promptPromise } = ctx.agent.peer.requestWithId('session/prompt', {
      content: [{ type: 'text', text: 'hello' }],
    });

    // Wait a bit for the turn to start, then cancel
    await new Promise((resolve) => setTimeout(resolve, 200));
    ctx.agent.peer.notify('session/cancel', { sessionId: created.sessionId });

    // Turn should end with cancelled status
    const result = (await withTimeout(promptPromise, 10_000, 'prompt')) as {
      stopReason: string;
      turnId: string;
    };

    expect(result.stopReason).toBe('cancelled');

    // Verify durable events show proper turn lifecycle
    const durable = (await withTimeout(
      ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

    // Should have context_injected (from session creation), prompt, turn_start, turn_end (cancelled) - no partial events
    expect(durable.events.map((e) => e.type)).toEqual([
      'context_injected',
      'prompt',
      'turn_start',
      'turn_end',
    ]);

    // Verify status shows no pending state
    const status = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { currentTurn?: unknown; pendingPermissions: unknown[] };

    expect(status.currentTurn).toBeUndefined();
    expect(status.pendingPermissions).toEqual([]);
  });

  it('aborts cleanly during tool execution', { timeout: 20_000 }, async () => {
    // Setup: Use test provider to trigger bash tool with a slow command
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    // Auto-approve permissions for this test
    ctx.agent.peer.onRequest('session/request_permission', async () => {
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

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Start a prompt that will run a slow bash command
    const { result: promptPromise } = ctx.agent.peer.requestWithId('session/prompt', {
      content: [{ type: 'text', text: 'run: sleep 10' }],
    });

    // Wait for tool execution to start (indicated by permission being handled and tool starting)
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const toolStarted = updates.find((u) => {
            const p = u as Record<string, unknown>;
            return p?.type === 'tool_use' && p?.status === 'running';
          });
          if (toolStarted) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      10_000,
      'tool_use running'
    );

    // Cancel during tool execution
    ctx.agent.peer.notify('session/cancel', { sessionId: created.sessionId });

    // Turn should end with cancelled status
    const result = (await withTimeout(promptPromise, 10_000, 'prompt')) as {
      stopReason: string;
    };

    expect(result.stopReason).toBe('cancelled');

    // Verify tool was marked as cancelled
    const toolCancelled = updates.find((u) => {
      const p = u as Record<string, unknown>;
      return p?.type === 'tool_use' && p?.status === 'cancelled';
    });
    expect(toolCancelled).toBeTruthy();

    // Verify no dangling state
    const status = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { currentTurn?: unknown; pendingPermissions: unknown[] };

    expect(status.currentTurn).toBeUndefined();
    expect(status.pendingPermissions).toEqual([]);
  });

  it('aborts cleanly while awaiting permission', { timeout: 15_000 }, async () => {
    // Setup: Trigger tool requiring permission, never respond
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    let sawPermissionRequest = false;
    ctx.agent.peer.onRequest('session/request_permission', async () => {
      sawPermissionRequest = true;
      // Never respond - wait forever
      return await new Promise(() => undefined);
    });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'ask' } })
      ),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Start a prompt that requires permission
    const { result: promptPromise } = ctx.agent.peer.requestWithId('session/prompt', {
      content: [{ type: 'text', text: 'run: echo test' }],
    });

    // Wait for permission request
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (sawPermissionRequest) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'permission request'
    );

    // Send cancel instead of approval
    ctx.agent.peer.notify('session/cancel', { sessionId: created.sessionId });

    // Turn should end with cancelled status
    const result = (await withTimeout(promptPromise, 5_000, 'prompt')) as {
      stopReason: string;
    };

    expect(result.stopReason).toBe('cancelled');

    // Verify tool was marked as cancelled
    const toolCancelled = updates.find((u) => {
      const p = u as Record<string, unknown>;
      return p?.type === 'tool_use' && p?.status === 'cancelled';
    });
    expect(toolCancelled).toBeTruthy();

    // Verify pending permissions cleared
    const status = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status'
    )) as { pendingPermissions: unknown[]; currentTurn?: unknown };

    expect(status.pendingPermissions).toEqual([]);
    expect(status.currentTurn).toBeUndefined();
  });

  it('handles abort when no turn is active', { timeout: 10_000 }, async () => {
    // Setup: Agent is idle
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Verify no turn is active
    const beforeStatus = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status before'
    )) as { currentTurn?: unknown };

    expect(beforeStatus.currentTurn).toBeUndefined();

    // Send cancel when idle - should be a no-op
    ctx.agent.peer.notify('session/cancel', { sessionId: created.sessionId });

    // Give it a moment to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify still idle and no error occurred
    const afterStatus = (await withTimeout(
      ctx.agent.peer.request('ent/agent/status'),
      2_000,
      'ent/agent/status after'
    )) as { currentTurn?: unknown };

    expect(afterStatus.currentTurn).toBeUndefined();

    // Verify we can still do normal operations
    writeFileSync(join(ctx.workDir, 'test.txt'), 'content\n', 'utf8');

    const result = (await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file test.txt' }],
      }),
      10_000,
      'session/prompt'
    )) as { stopReason: string };

    expect(result.stopReason).toBe('end_turn');
  });

  it('allows new turn after abort', { timeout: 20_000 }, async () => {
    // Setup: Start and abort a turn, then start a new one
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_TEST_PROVIDER_STREAM_DELAY_MS: '2000',
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

    const created = (await withTimeout(
      ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // First turn - abort it
    const { result: firstPromptPromise } = ctx.agent.peer.requestWithId('session/prompt', {
      content: [{ type: 'text', text: 'first message' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    ctx.agent.peer.notify('session/cancel', { sessionId: created.sessionId });

    const firstResult = (await withTimeout(firstPromptPromise, 10_000, 'first prompt')) as {
      stopReason: string;
      turnId: string;
    };

    expect(firstResult.stopReason).toBe('cancelled');
    const firstTurnId = firstResult.turnId;

    // Clear the streaming delay for the second turn
    await ctx.agent.shutdown();
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      // No streaming delay for second turn
    });

    const secondUpdates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      secondUpdates.push(params);
      return undefined;
    });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );

    // Load the same session
    const list = (await withTimeout(
      ctx.agent.peer.request('session/list', { cwd: ctx.workDir }),
      2_000,
      'session/list'
    )) as { sessions: Array<{ sessionId: string }> };

    expect(list.sessions.length).toBeGreaterThan(0);
    const sessionId = list.sessions[0]!.sessionId;

    await withTimeout(
      ctx.agent.peer.request('session/load', { sessionId, cwd: ctx.workDir, mcpServers: [] }),
      2_000,
      'session/load'
    );

    // Create a file for the second turn to read
    writeFileSync(join(ctx.workDir, 'test.txt'), 'hello world\n', 'utf8');

    // Second turn - should complete normally
    const secondResult = (await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'read file test.txt' }],
      }),
      10_000,
      'second prompt'
    )) as { stopReason: string; turnId: string };

    expect(secondResult.stopReason).toBe('end_turn');
    expect(secondResult.turnId).not.toBe(firstTurnId);

    // Verify event sequence is correct (continues from where we left off)
    const durable = (await withTimeout(
      ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

    // First turn: prompt, turn_start, turn_end (cancelled)
    // Second turn: prompt, turn_start, message (reading), tool_use, message (result), turn_end
    const eventTypes = durable.events.map((e) => e.type);
    expect(eventTypes).toContain('prompt');
    expect(eventTypes).toContain('turn_start');
    expect(eventTypes).toContain('turn_end');
    expect(eventTypes.filter((t) => t === 'turn_start').length).toBe(2);
    expect(eventTypes.filter((t) => t === 'turn_end').length).toBe(2);

    // Verify event sequences are strictly increasing
    for (let i = 1; i < durable.events.length; i++) {
      expect(durable.events[i]!.eventSeq).toBeGreaterThan(durable.events[i - 1]!.eventSeq);
    }
  });
});
