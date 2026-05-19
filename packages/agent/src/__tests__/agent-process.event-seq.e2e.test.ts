import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent durable event sequencing (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-event-seq' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'maintains strictly increasing eventSeq across delegate job creation',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      ctx.agent.peer.onRequest('session/update', async () => undefined);
      ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'ask' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'delegate hi' }],
        }),
        10_000,
        'session/prompt delegate'
      );

      const history = (await withTimeout(
        ctx.agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 1_000 }),
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
