import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

describe('lace-agent durable event sequencing (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-event-seq-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-event-seq-e2e-wd-'));
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
    'maintains strictly increasing eventSeq across delegate job creation',
    { timeout: 20_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir, env: { LACE_AGENT_TEST_PROVIDER: '1' } });

      agent.peer.onRequest('session/update', async () => undefined);
      agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

      await withTimeout(
        agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'delegate hi' }],
        }),
        10_000,
        'session/prompt delegate'
      );

      const history = (await withTimeout(
        agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 1_000 }),
        2_000,
        'ent/session/events'
      )) as { events: Array<{ eventSeq: number }>; hasMore: boolean };

      expect(history.events.length).toBeGreaterThan(0);

      for (let i = 1; i < history.events.length; i++) {
        expect(history.events[i]!.eventSeq).toBeGreaterThan(history.events[i - 1]!.eventSeq);
      }
    }
  );
});
