// ABOUTME: E2E coverage that a firing alarm wakes the agent out of idle by
// ABOUTME: kicking off an internal turn (PRI-1744 Task 21). Verified by counting
// ABOUTME: turn_start events in events.jsonl — the scheduling turn produces one,
// ABOUTME: and the alarm's idle-wake should produce a second.

import { readFileSync } from 'node:fs';
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
  const raw = readFileSync(eventsPath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DurableEvent);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('lace-agent alarm idle wake (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-idle' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'fires a one-shot alarm while idle and triggers an internal turn',
    { timeout: 15_000 },
    async () => {
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

      const fireAtIso = new Date(Date.now() + 1_500).toISOString();

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: `alarm: schedule=${fireAtIso} prompt=wakeup` }],
        }),
        10_000,
        'session/prompt (schedule alarm)'
      );

      // Wait long enough for the alarm to fire and the idle-wake internal turn
      // to start and finish.
      await sleep(4_000);

      const events = readEvents(ctx.laceDir, created.sessionId);
      const turnStarts = events.filter((e) => e.type === 'turn_start');

      // First turn_start: the user-issued scheduling turn.
      // Second turn_start: the idle-wake fired by the scheduler's notifier.
      expect(turnStarts.length).toBeGreaterThanOrEqual(2);

      const alarmFired = events.find((e) => {
        if (e.type !== 'context_injected') return false;
        const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
        return content.some((b) => (b.text ?? '').includes('<notification kind="alarm-fired"'));
      });
      expect(alarmFired).toBeDefined();
    }
  );
});
