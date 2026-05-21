// ABOUTME: E2E coverage that a scheduled one-shot alarm fires and lands in
// ABOUTME: events.jsonl as an immediate-priority context_injected event
// ABOUTME: containing the alarm-fired notification body (PRI-1744 Task 20).

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

describe('lace-agent alarm fire delivery (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-fire' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'delivers a scheduled one-shot alarm as a context_injected event',
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

      const fireAtIso = new Date(Date.now() + 2_000).toISOString();

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: `alarm: schedule=${fireAtIso} prompt=ping` }],
        }),
        10_000,
        'session/prompt (schedule alarm)'
      );

      // Wait for the alarm to fire. The scheduler's setTimeout fires precisely
      // at the requested time; we add headroom for I/O and the backstop poll.
      await sleep(3_500);

      const events = readEvents(ctx.laceDir, created.sessionId);
      const injected = events.filter((e) => e.type === 'context_injected');
      expect(injected.length).toBeGreaterThan(0);

      const alarmFiredText = injected
        .map((e) => {
          const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
          return content.map((b) => b.text ?? '').join('\n');
        })
        .find((text) => text.includes('<notification kind="alarm-fired"'));

      expect(alarmFiredText).toBeDefined();
      expect(alarmFiredText).toContain('ping');

      const alarmFiredEvent = injected.find((e) => {
        const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
        return content.some((b) => (b.text ?? '').includes('<notification kind="alarm-fired"'));
      });
      expect(alarmFiredEvent?.data?.priority).toBe('immediate');
    }
  );
});
