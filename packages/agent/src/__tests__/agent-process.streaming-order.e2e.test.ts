import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

type SessionUpdateParams = {
  sessionId: string;
  streamSeq: number;
  turnId?: string;
  turnSeq?: number;
  type: string;
  [key: string]: unknown;
};

async function waitFor(
  predicate: () => boolean,
  params: { timeoutMs: number; intervalMs: number; label: string }
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, params.intervalMs));
  }
  throw new Error(`Timed out waiting for ${params.label}`);
}

describe('lace-agent streaming update ordering (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-stream-order-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-stream-order-e2e-wd-'));
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

  it('does not emit text_delta after turn_end for a turn', { timeout: 20_000 }, async () => {
    agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

    const updates: SessionUpdateParams[] = [];
    agent.peer.onRequest('session/update', async (params: unknown) => {
      if (params && typeof params === 'object') {
        const p = params as SessionUpdateParams;
        if (typeof p.type === 'string') updates.push(p);
      }
      return undefined;
    });

    agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );
    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    const promptResult = (await withTimeout(
      agent.peer.request('session/prompt', { content: [{ type: 'text', text: 'hi' }] }),
      10_000,
      'session/prompt'
    )) as { turnId: string };

    const turnId = promptResult.turnId;

    await waitFor(() => updates.some((u) => u.turnId === turnId && u.type === 'turn_end'), {
      timeoutMs: 2_000,
      intervalMs: 10,
      label: 'turn_end update',
    });

    await new Promise((r) => setTimeout(r, 200));

    const turnUpdates = updates.filter((u) => u.turnId === turnId);
    const turnEndIndex = turnUpdates.findIndex((u) => u.type === 'turn_end');
    expect(turnEndIndex).toBeGreaterThanOrEqual(0);

    const lastTextDeltaIndex = (() => {
      let idx = -1;
      for (let i = 0; i < turnUpdates.length; i++) {
        if (turnUpdates[i]?.type === 'text_delta') idx = i;
      }
      return idx;
    })();

    expect(lastTextDeltaIndex).toBeGreaterThanOrEqual(0);
    expect(lastTextDeltaIndex).toBeLessThan(turnEndIndex);
  });
});
