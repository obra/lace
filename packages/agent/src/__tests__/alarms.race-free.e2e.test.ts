// ABOUTME: E2E coverage that alarms firing under load produce monotonic,
// ABOUTME: gap-free eventSeq values in events.jsonl — verifying that the
// ABOUTME: scheduler's notifier serializes through the runner's runExclusive
// ABOUTME: mutex (PRI-1744 Bug 1 regression).

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
  eventSeq: number;
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

describe('lace-agent alarm race-free eventSeq (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-race-free' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'produces strictly-increasing eventSeq even when an alarm fires concurrently',
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

      // Schedule the alarm to fire ~immediately so it lands close to the
      // scheduling turn's writes — maximizing the chance of a race.
      const fireAtIso = new Date(Date.now() + 200).toISOString();
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: `alarm: schedule=${fireAtIso} prompt=wakeup` }],
        }),
        10_000,
        'session/prompt (schedule alarm)'
      );

      // Let the alarm fire and its idle-wake turn complete.
      await sleep(3_000);

      const events = readEvents(ctx.laceDir, created.sessionId);
      expect(events.length).toBeGreaterThan(3);

      // Every eventSeq must appear exactly once and the sequence must be
      // strictly increasing starting from 1.
      const seqs = events.map((e) => e.eventSeq);
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(seqs.length);
      for (let i = 0; i < seqs.length; i++) {
        expect(seqs[i]).toBe(i + 1);
      }

      // The alarm-fired notification must have landed (otherwise the test
      // didn't actually exercise the contested code path).
      const alarmFired = events.find((e) => {
        if (e.type !== 'context_injected') return false;
        const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
        return content.some((b) => (b.text ?? '').includes('<notification kind="alarm-fired"'));
      });
      expect(alarmFired).toBeDefined();
    }
  );
});
