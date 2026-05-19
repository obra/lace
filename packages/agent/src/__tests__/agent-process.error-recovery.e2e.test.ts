// ABOUTME: E2E tests for tool error recovery behavior
// Tests that recoverable errors (failed status) allow the model to continue,
// while fatal errors (denied/cancelled/aborted) stop the turn.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent error recovery (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-error-recovery' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'continues turn after recoverable tool error (file not found), model sees error and responds',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

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

      // Ask to read a non-existent file - this will fail with "file not found"
      // The key behavior: the turn should CONTINUE, allowing the model to see the error
      // and respond (instead of stopping the turn on failure)
      const promptResult = (await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file nonexistent.txt' }],
        }),
        10_000,
        'session/prompt'
      )) as { turnId: string; stopReason: string };

      // Wait for turn to complete
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const turnEnd = updates.find((u) => {
              const p = u as Record<string, unknown>;
              return p?.type === 'turn_end' && p?.turnId === promptResult.turnId;
            });
            if (turnEnd) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        8_000,
        'turn_end'
      );

      // Get events to verify the sequence
      const durable = (await withTimeout(
        ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string; data?: unknown }>; hasMore: boolean };

      // Should see: context_injected, prompt, turn_start, message, tool_use (failed), message (model's response to error), turn_end
      const eventTypes = durable.events.map((e) => e.type);

      // The tool_use event should have failed status
      const toolUseEvents = durable.events.filter((e) => e.type === 'tool_use');
      expect(toolUseEvents.length).toBe(1);

      const toolData = toolUseEvents[0].data as Record<string, unknown>;
      const result = toolData.result as Record<string, unknown>;
      expect(result.outcome).toBe('failed');

      // CRITICAL: There should be a message AFTER the failed tool_use
      // This proves the turn continued and the model got to respond
      const toolUseIndex = eventTypes.indexOf('tool_use');
      const messageAfterTool = eventTypes.slice(toolUseIndex + 1).includes('message');
      expect(messageAfterTool).toBe(true);

      // Turn should complete normally (not stopped by the error)
      expect(promptResult.stopReason).toBe('end_turn');
    }
  );

  it('stops turn immediately on permission denied (fatal error)', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    const updates: unknown[] = [];
    ctx.agent.peer.onRequest('session/update', async (params) => {
      updates.push(params);
      return undefined;
    });

    // Deny all permission requests
    ctx.agent.peer.onRequest('session/request_permission', async () => {
      return { decision: 'deny' };
    });

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

    // Create a file so the test provider will try file_write (needs permission)
    const promptResult = (await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'write file test.txt' }],
      }),
      10_000,
      'session/prompt'
    )) as { turnId: string; stopReason: string };

    // Wait for turn to complete
    await withTimeout(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const turnEnd = updates.find((u) => {
            const p = u as Record<string, unknown>;
            return p?.type === 'turn_end' && p?.turnId === promptResult.turnId;
          });
          if (turnEnd) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      }),
      5_000,
      'turn_end'
    );

    // Get events to verify the sequence
    const durable = (await withTimeout(
      ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as { events: Array<{ eventSeq: number; type: string; data?: unknown }>; hasMore: boolean };

    const eventTypes = durable.events.map((e) => e.type);

    // Should see only ONE tool_use event (denied, turn stopped)
    const toolUseEvents = durable.events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents.length).toBe(1);

    // Tool use should have denied status
    const toolData = toolUseEvents[0].data as Record<string, unknown>;
    const result = toolData.result as Record<string, unknown>;
    expect(result.outcome).toBe('denied');

    // CRITICAL: There should be NO message after the denied tool_use
    // This proves the turn stopped immediately
    const toolUseIndex = eventTypes.indexOf('tool_use');
    const messageAfterTool = eventTypes.slice(toolUseIndex + 1).includes('message');
    expect(messageAfterTool).toBe(false);

    // Turn should end (not continue after denial)
    expect(promptResult.stopReason).toBe('end_turn');
  });

  it(
    'model can retry with corrected parameters after seeing recoverable error',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: {
          // Enable retry behavior: test provider will retry with fallback.txt after seeing error
          LACE_TEST_PROVIDER_RETRY_ON_ERROR: '1',
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

      // Create a fallback file that the model will try after the first one fails
      writeFileSync(join(ctx.workDir, 'fallback.txt'), 'fallback content\n', 'utf8');

      // First file doesn't exist - model will try it, see error, retry with fallback.txt
      const promptResult = (await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'read file wrong.txt' }],
        }),
        10_000,
        'session/prompt'
      )) as { turnId: string; stopReason: string };

      // Wait for turn to complete
      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const turnEnd = updates.find((u) => {
              const p = u as Record<string, unknown>;
              return p?.type === 'turn_end' && p?.turnId === promptResult.turnId;
            });
            if (turnEnd) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        8_000,
        'turn_end'
      );

      // Get events to verify the sequence
      const durable = (await withTimeout(
        ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string; data?: unknown }>; hasMore: boolean };

      // Should see TWO tool_use events: first fails, second succeeds
      const toolUseEvents = durable.events.filter((e) => e.type === 'tool_use');
      expect(toolUseEvents.length).toBe(2);

      // First tool use should have failed status (file not found)
      const firstToolData = toolUseEvents[0].data as Record<string, unknown>;
      const firstResult = firstToolData.result as Record<string, unknown>;
      expect(firstResult.outcome).toBe('failed');

      // Second tool use should have completed status (fallback file)
      const secondToolData = toolUseEvents[1].data as Record<string, unknown>;
      const secondResult = secondToolData.result as Record<string, unknown>;
      expect(secondResult.outcome).toBe('completed');

      // Turn should complete normally
      expect(promptResult.stopReason).toBe('end_turn');
    }
  );
});
