// ABOUTME: Regression test for Bug 3 (PRI-1744) — a context_injected priority=immediate
// ABOUTME: event that lands after the runner's last iteration but before/around turn_end
// ABOUTME: must still trigger a synthetic follow-up turn. The idle-wake's setImmediate
// ABOUTME: can no-op if it fires while activeTurn is still set; the post-turn rescan
// ABOUTME: in prompt.ts closes this race by re-checking after activeTurn is cleared.

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
  eventSeq?: number;
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

describe('lace-agent alarm post-turn wake (Bug 3 regression, E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-post-turn' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'triggers a synthetic turn when an immediate-inject lands close to turn_end',
    { timeout: 30_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      const created = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      // Schedule an alarm that fires ~1.1s from now. The scheduling turn itself
      // is short (test provider returns immediately), so the alarm will fire
      // while the agent is idle — but closely enough to the turn's end that it
      // exercises the post-turn rescan path.
      const fireAtIso = new Date(Date.now() + 1_100).toISOString();

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: `alarm: schedule=${fireAtIso} prompt=ping` }],
        }),
        10_000,
        'session/prompt (schedule alarm)'
      );

      // Give time for the alarm to fire and for the synthetic wake turn to complete.
      await sleep(5_000);

      const events = readEvents(ctx.laceDir, created.sessionId);

      // The alarm-fired context_injected event must be present.
      const alarmFired = events.find((e) => {
        if (e.type !== 'context_injected') return false;
        const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
        return content.some((b) => (b.text ?? '').includes('<notification kind="alarm-fired"'));
      });
      expect(alarmFired, 'alarm-fired notification should land in events.jsonl').toBeDefined();
      expect(alarmFired?.data?.priority).toBe('immediate');

      // There must be at least two turn_start events:
      //   1. The user-issued scheduling turn.
      //   2. The synthetic wake turn triggered after the alarm notification landed.
      const turnStarts = events.filter((e) => e.type === 'turn_start');
      expect(
        turnStarts.length,
        'expected at least 2 turn_start events (scheduling turn + alarm-wake turn)'
      ).toBeGreaterThanOrEqual(2);
    }
  );
});
