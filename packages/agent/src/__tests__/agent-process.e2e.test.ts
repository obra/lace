import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';

describe('lace-agent process (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-e2e-wd-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it(
    'initializes, creates a session, streams updates, and persists durable events',
    { timeout: 15_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      const updates: unknown[] = [];
      agent.peer.onRequest('session/update', async (params) => {
        updates.push(params);
        return undefined;
      });

      await withTimeout(
        agent.peer.request('initialize', { protocolVersion: '1.0' }),
        2_000,
        'initialize'
      );

      const created = (await withTimeout(
        agent.peer.request('session/new', { workDir }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      const promptResult = (await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'hi' }],
        }),
        2_000,
        'session/prompt'
      )) as { turnId: string };

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const match = updates.find((u) => {
              const p = u as Record<string, unknown>;
              return (
                p?.type === 'text_delta' && p?.text === 'hello' && p?.turnId === promptResult.turnId
              );
            });
            if (match) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        2_000,
        'session/update stream'
      );

      const durable = (await withTimeout(
        agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

      expect(durable.hasMore).toBe(false);
      expect(durable.events.map((e) => e.type)).toEqual([
        'prompt',
        'turn_start',
        'message',
        'turn_end',
      ]);
      expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4]);

      const list = (await withTimeout(
        agent.peer.request('session/list', { workDir }),
        2_000,
        'session/list'
      )) as { sessions: Array<{ sessionId: string }> };

      expect(list.sessions.map((s) => s.sessionId)).toContain(created.sessionId);
    }
  );

  it('keeps JSONL session history across agent restarts', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(
      agent.peer.request('initialize', { protocolVersion: '1.0' }),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    await withTimeout(
      agent.peer.request('session/prompt', { content: [{ type: 'text', text: 'hi' }] }),
      2_000,
      'session/prompt'
    );

    await agent.shutdown();
    agent = undefined;

    agent = spawnAgentProcess({ laceDir });
    await withTimeout(
      agent.peer.request('initialize', { protocolVersion: '1.0' }),
      2_000,
      'initialize (restart)'
    );

    await withTimeout(
      agent.peer.request('session/load', { sessionId: created.sessionId }),
      2_000,
      'session/load (restart)'
    );

    const durable = (await withTimeout(
      agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events (restart)'
    )) as { events: Array<{ eventSeq: number; type: string }>; hasMore: boolean };

    expect(durable.events.map((e) => e.type)).toEqual([
      'prompt',
      'turn_start',
      'message',
      'turn_end',
    ]);
    expect(durable.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4]);
  });
});
