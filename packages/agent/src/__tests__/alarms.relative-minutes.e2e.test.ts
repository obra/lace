// ABOUTME: E2E — schedule a one-shot timer via `minutes=N` (relative-time input),
// ABOUTME: verify the alarm-fired notification body says "Your N-minute timer just fired"
// ABOUTME: (not an absolute ISO timestamp). Marked slow: waits ~70s for the alarm to fire.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  defaultInitializeParams,
  spawnAgentProcess,
  withTimeout,
} from './helpers';

interface DurableEvent {
  type: string;
  data?: {
    priority?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
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

describe('alarms e2e — relative-minutes once timer', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-rel-min' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'fires with N-minute timer wording (not absolute ISO timestamp)',
    // Slow: minutes=1 means the scheduler waits ~60s before firing, plus up to
    // BACKSTOP_POLL_MS=5s headroom. Total wait is ~70s; timeout is 90s.
    { timeout: 90_000 },
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

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'alarm: minutes=1 prompt=ping' }],
        }),
        10_000,
        'session/prompt (schedule relative)'
      );

      // Wait for the alarm to fire: minutes=1 → ~60s + up to 5s backstop poll headroom.
      await sleep(70_000);

      const events = readEvents(ctx.laceDir, created.sessionId);

      const alarmFiredEvent = events.find(
        (e) =>
          e.type === 'context_injected' &&
          e.data?.priority === 'immediate' &&
          e.data?.content?.some((b) => (b.text ?? '').includes('<notification kind="alarm-fired"'))
      );
      expect(alarmFiredEvent, 'alarm-fired notification should have landed').toBeDefined();

      const text = (alarmFiredEvent!.data!.content ?? []).map((b) => b.text ?? '').join('\n');

      // Key assertion: relative wording, not absolute ISO form.
      expect(text).toContain('Your 1-minute timer just fired');
      expect(text).toContain('"ping"');

      // Must NOT contain an ISO-8601 timestamp in the body — that's the absolute path's wording.
      // The once-relative body is: `Your 1-minute timer just fired. Note: "ping".`
      // No ISO date should appear in that sentence.
      expect(text).toMatch(/Your 1-minute timer just fired\. Note: "ping"\./);
    }
  );
});
