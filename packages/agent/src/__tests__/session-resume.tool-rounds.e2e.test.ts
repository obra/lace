// ABOUTME: Native session resume preserves model-response tool batches and their results.
// ABOUTME: Uses real RPC, storage and filesystem tools; only external inference is scripted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import type { AgentServerState } from '../server-types';
import type { ProviderMessage, ProviderResponse } from '../providers/base-provider';
import { TestAgentProvider } from '../runtime/test-provider';
import { defaultInitializeParams } from './helpers/initialize';

function createPairedPeers(state: AgentServerState) {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const client = new JsonRpcPeer(createNdjsonStdioTransport({ readable: bToA, writable: aToB }), {
    idPrefix: 'c_',
  });
  const server = new JsonRpcPeer(createNdjsonStdioTransport({ readable: aToB, writable: bToA }), {
    idPrefix: 'a_',
  });
  registerAgentRpcMethods(server, state);
  client.onRequest('session/update', async () => undefined);
  client.onRequest('session/request_permission', async () => ({ decision: 'allow' }));
  return { client, server };
}

function toolHistory(messages: ProviderMessage[]) {
  return messages
    .filter((message) => message.toolCalls?.length || message.toolResults?.length)
    .map(({ role, toolCalls, toolResults }) => ({ role, toolCalls, toolResults }));
}

describe('session/resume tool-round chronology', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let laceDir: string;
  let workDir: string;
  const agents: { state: AgentServerState; peers: ReturnType<typeof createPairedPeers> }[] = [];

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-resume-tool-rounds-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-resume-tool-rounds-wd-'));
    process.env.LACE_DIR = laceDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(async () => {
    for (const { state, peers } of agents.splice(0)) {
      await state.reminderScheduler?.stop();
      await state.mcpServerManager.shutdown();
      peers.client.close();
      peers.server.close();
    }
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;
    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  async function startAgent() {
    const state = createAgentServerState();
    const peers = createPairedPeers(state);
    const agent = { state, peers };
    agents.push(agent);
    await peers.client.request(
      'initialize',
      defaultInitializeParams({ config: { approvalMode: 'approve' } })
    );
    return agent;
  }

  it('keeps a parallel pair and a later dependent tool call in separate response batches', async () => {
    // Dropping textless message events must fail this test: after resume the
    // dependent read would move ahead of the writes' results into their batch.
    const requests: ProviderMessage[][] = [];
    const responses: ProviderResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'write_left',
            name: 'file_write',
            arguments: { path: 'left.txt', content: 'left\n' },
          },
          {
            id: 'write_right',
            name: 'file_write',
            arguments: { path: 'right.txt', content: 'right\n' },
          },
        ],
        stopReason: 'tool_use',
      },
      {
        content: '',
        toolCalls: [{ id: 'read_left', name: 'file_read', arguments: { path: 'left.txt' } }],
        stopReason: 'tool_use',
      },
      // A terminal stop avoids the separate verification-reminder retry, so
      // the captured prefix contains only the two tool responses under test.
      { content: 'Done.', toolCalls: [], stopReason: 'stop_sequence' },
      { content: 'Resumed.', toolCalls: [], stopReason: 'end_turn' },
    ];
    vi.spyOn(TestAgentProvider.prototype, 'createStreamingResponse').mockImplementation(
      async (messages) => {
        requests.push(structuredClone(messages));
        const response = responses.shift();
        if (!response) throw new Error('Unexpected inference request');
        return response;
      }
    );

    const first = await startAgent();
    const { sessionId } = (await first.peers.client.request('session/new', {
      cwd: workDir,
      mcpServers: [],
    })) as { sessionId: string };
    await first.peers.client.request('session/prompt', {
      content: [{ type: 'text', text: 'Write both files, then read the left file.' }],
    });

    expect(requests).toHaveLength(3);
    expect(readFileSync(join(workDir, 'left.txt'), 'utf8')).toBe('left\n');
    expect(readFileSync(join(workDir, 'right.txt'), 'utf8')).toBe('right\n');
    const live = requests[2]!;
    expect(live.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(live[1]!.toolCalls).toEqual([
      { id: 'write_left', name: 'file_write', arguments: { path: 'left.txt', content: 'left\n' } },
      {
        id: 'write_right',
        name: 'file_write',
        arguments: { path: 'right.txt', content: 'right\n' },
      },
    ]);
    expect(live[2]!.toolResults?.map((result) => [result.id, result.status])).toEqual([
      ['write_left', 'completed'],
      ['write_right', 'completed'],
    ]);
    expect(live[3]!.toolCalls).toEqual([
      { id: 'read_left', name: 'file_read', arguments: { path: 'left.txt' } },
    ]);
    expect(live[4]!.toolResults).toMatchObject([
      {
        id: 'read_left',
        status: 'completed',
        content: [{ type: 'text', text: expect.stringContaining('left') }],
      },
    ]);

    await first.state.reminderScheduler?.stop();
    await first.state.mcpServerManager.shutdown();
    first.peers.client.close();
    first.peers.server.close();
    agents.splice(agents.indexOf(first), 1);

    // A fresh state has no live projection cache: session/resume must load the
    // actual stored events, and the next request must retain their chronology.
    const resumed = await startAgent();
    expect(resumed.state.projectionCache.size).toBe(0);
    await resumed.peers.client.request('session/resume', {
      sessionId,
      cwd: workDir,
      mcpServers: [],
    });
    await resumed.peers.client.request('session/prompt', {
      content: [{ type: 'text', text: 'Continue.' }],
    });

    expect(requests).toHaveLength(4);
    const afterResume = requests[3]!;
    expect(toolHistory(afterResume)).toEqual(toolHistory(live));
    expect(afterResume.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(afterResume.slice(live.length)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      { role: 'user', content: 'Continue.' },
    ]);
  });
});
