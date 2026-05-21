// ABOUTME: E2E coverage that an alarm scheduled in one agent process survives
// ABOUTME: agent restart and fires after session/load wires the scheduler back
// ABOUTME: up (PRI-1744 Task 22).

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

describe('lace-agent alarm restart recovery (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-restart' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('fires an alarm whose schedule survives an agent restart', { timeout: 25_000 }, async () => {
    // First boot: schedule an alarm a few seconds in the future, then shut
    // down the agent before it has a chance to fire.
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

    const fireAtMs = Date.now() + 5_000;
    const fireAtIso = new Date(fireAtMs).toISOString();

    await withTimeout(
      ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: `alarm: schedule=${fireAtIso} prompt=postrestart` }],
      }),
      10_000,
      'session/prompt (schedule alarm)'
    );

    await ctx.agent.shutdown();
    ctx.agent = undefined;

    // Second boot: same LACE_DIR, reload session. The scheduler should be
    // re-wired and pick up the persisted alarm.
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize (restart)'
    );
    await withTimeout(
      ctx.agent.peer.request('session/load', {
        sessionId: created.sessionId,
        cwd: ctx.workDir,
        mcpServers: [],
      }),
      2_000,
      'session/load (restart)'
    );

    // Wait until we are well past the alarm's scheduled fire time, plus
    // headroom for the scheduler's backstop poll and write latency.
    const waitMs = Math.max(0, fireAtMs - Date.now()) + 3_500;
    await sleep(waitMs);

    const events = readEvents(ctx.laceDir, created.sessionId);
    const alarmFired = events.find((e) => {
      if (e.type !== 'context_injected') return false;
      const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
      return content.some((b) => (b.text ?? '').includes('<notification kind="alarm-fired"'));
    });
    expect(alarmFired).toBeDefined();
    const text = ((alarmFired?.data?.content ?? []) as Array<{ text?: string }>)
      .map((b) => b.text ?? '')
      .join('\n');
    expect(text).toContain('postrestart');
  });
});
