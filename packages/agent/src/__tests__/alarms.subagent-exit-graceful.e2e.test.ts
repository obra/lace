// ABOUTME: E2E coverage that when a subagent exits gracefully with pending
// ABOUTME: alarms, the parent receives a context_injected subagent-exited
// ABOUTME: notification listing the un-fireable alarms (PRI-1744 Task 24).

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

describe('lace-agent subagent exit with pending alarm (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-subexit-graceful' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'emits subagent-exited notification in the parent when a subagent had a pending alarm',
    { timeout: 25_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: Array<Record<string, unknown>> = [];
      ctx.agent.peer.onRequest('session/update', async (params) => {
        updates.push(params as Record<string, unknown>);
        return undefined;
      });

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

      // Schedule the alarm far in the future so it is still pending when the
      // subagent shuts down.
      const farFutureIso = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [
            { type: 'text', text: `subagent: alarm: schedule=${farFutureIso} prompt=ping` },
          ],
        }),
        15_000,
        'session/prompt (subagent schedule alarm)'
      );

      // Find the subagent's session id via the job_session_assigned event in
      // the parent's events.jsonl.
      let subagentSessionId: string | undefined;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !subagentSessionId) {
        const events = readEvents(ctx.laceDir, parent.sessionId);
        const assigned = events.find(
          (e) =>
            e.type === 'job_session_assigned' &&
            typeof (e.data as { subagentSessionId?: unknown } | undefined)?.subagentSessionId ===
              'string'
        );
        if (assigned) {
          subagentSessionId = (assigned.data as { subagentSessionId: string }).subagentSessionId;
        } else {
          await sleep(50);
        }
      }
      expect(subagentSessionId).toBeDefined();

      // The subagent's process is killed at the end of the delegate flow, which
      // triggers its graceful shutdown hook (emitSubagentExitedIfNeeded). That
      // writes a subagent-exited notification into the parent's events.jsonl.
      // Give it enough headroom to flush.
      const exitDeadline = Date.now() + 5_000;
      let subagentExited: DurableEvent | undefined;
      while (Date.now() < exitDeadline && !subagentExited) {
        const events = readEvents(ctx.laceDir, parent.sessionId);
        subagentExited = events.find((e) => {
          if (e.type !== 'context_injected') return false;
          const content = (e.data?.content ?? []) as Array<{ type: string; text?: string }>;
          return content.some((b) =>
            (b.text ?? '').includes('<notification kind="subagent-exited"')
          );
        });
        if (!subagentExited) await sleep(100);
      }

      expect(subagentExited).toBeDefined();
      const text = ((subagentExited?.data?.content ?? []) as Array<{ text?: string }>)
        .map((b) => b.text ?? '')
        .join('\n');
      expect(text).toContain(subagentSessionId as string);
      expect(text).toContain('ping');
      expect(subagentExited?.data?.priority).toBe('immediate');
    }
  );
});
