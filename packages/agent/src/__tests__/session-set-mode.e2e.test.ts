import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { createE2EContext, defaultInitializeParams } from './helpers';

function createPairedPeers(register: (peer: JsonRpcPeer) => void) {
  const aToB = new PassThrough();
  const bToA = new PassThrough();

  const clientTransport = createNdjsonStdioTransport({ readable: bToA, writable: aToB });
  const serverTransport = createNdjsonStdioTransport({ readable: aToB, writable: bToA });

  const client = new JsonRpcPeer(clientTransport, { idPrefix: 'c_' });
  const server = new JsonRpcPeer(serverTransport, { idPrefix: 'a_' });
  register(server);

  return { client, server };
}

describe('session/set_mode', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-set-mode' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('switches tool availability between plan and execute', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve' } })
      );
      await client.request('session/new', { workDir: ctx.workDir });

      const setPlan = await client.request('session/set_mode', { mode: 'plan' });
      expect(setPlan).toEqual({ mode: 'plan', previousMode: 'execute' });

      await client.request('session/prompt', {
        content: [{ type: 'text', text: 'write file foo.txt' }],
      });

      const planEvents = (await client.request('ent/session/events', { limit: 50 })) as any;
      const planToolUse = planEvents.events.find((e: any) => e.type === 'tool_use');
      expect(planToolUse).toMatchObject({
        type: 'tool_use',
        data: {
          name: 'file_write',
          result: {
            outcome: 'denied',
            content: [{ type: 'error', message: 'Tool denied in plan mode' }],
          },
        },
      });

      const setExecute = await client.request('session/set_mode', { mode: 'execute' });
      expect(setExecute).toEqual({ mode: 'execute', previousMode: 'plan' });

      await client.request('session/prompt', {
        content: [{ type: 'text', text: 'write file foo.txt' }],
      });

      const content = readFileSync(join(ctx.workDir, 'foo.txt'), 'utf8');
      expect(content).toBe('written by test provider\n');
    } finally {
      client.close();
      server.close();
    }
  });
});
