// ABOUTME: E2E coverage that when a subagent exits gracefully with no pending
// ABOUTME: alarms, no subagent-exited notification is written into the parent's
// ABOUTME: events.jsonl — alarms-related plumbing is silent in the common case
// ABOUTME: (PRI-1744 Task 25).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

interface DurableEvent {
  type: string;
  data?: Record<string, unknown>;
}

function readEvents(laceDir: string, sessionId: string): DurableEvent[] {
  const eventsPath = join(laceDir, 'agent-sessions', sessionId, 'events.jsonl');
  if (!existsSync(eventsPath)) return [];
  const raw = readFileSync(eventsPath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DurableEvent);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('lace-agent subagent exit with no pending alarm (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-subexit-silent' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'does not emit a subagent-exited notification when the subagent had no pending alarms',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      await withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        2_000,
        'initialize'
      );

      const parent = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      // Run a subagent that schedules no alarms.
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'subagent: hi' }],
        }),
        15_000,
        'session/prompt (subagent without alarm)'
      );

      // Wait long enough for the subagent process to be torn down and any
      // shutdown-time writes to land.
      await sleep(3_000);

      const events = readEvents(ctx.laceDir, parent.sessionId);
      const subagentExited = events.find((e) => {
        if (e.type !== 'context_injected') return false;
        const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
        return content.some((b) => (b.text ?? '').includes('<notification kind="subagent-exited"'));
      });
      expect(subagentExited).toBeUndefined();
    }
  );
});
