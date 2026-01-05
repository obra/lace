import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';

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
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let laceDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-workdir-'));
    process.env.LACE_DIR = laceDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('switches tool availability between plan and execute', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve' } })
      );
      await client.request('session/new', { workDir });

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

      const content = readFileSync(join(workDir, 'foo.txt'), 'utf8');
      expect(content).toBe('written by test provider\n');
    } finally {
      client.close();
      server.close();
    }
  });
});
