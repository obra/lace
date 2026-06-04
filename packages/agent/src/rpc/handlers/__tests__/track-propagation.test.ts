// ABOUTME: Tests that the `track` field is carried end-to-end from RPC params
// ABOUTME: through to the durable event's data.track for both session/prompt and
// ABOUTME: ent/session/inject handlers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import { getSessionDir } from '@lace/agent/storage/session-store';

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

describe('track field propagation', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;
  let state: ReturnType<typeof createAgentServerState>;
  let client: JsonRpcPeer;
  let server: JsonRpcPeer;
  let sessionId: string;
  let sessionDir: string;

  beforeEach(async () => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-track-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-track-wd-'));
    process.env.LACE_DIR = tempDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    state = createAgentServerState();
    ({ client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state)));

    await client.request('initialize', defaultInitializeParams());
    const newResult = (await client.request('session/new', {
      cwd: workDir,
      mcpServers: [],
    })) as { sessionId: string };
    sessionId = newResult.sessionId;
    sessionDir = getSessionDir(sessionId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;
    client.close();
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  describe('session/prompt', () => {
    it('writes track onto the prompt event when passed in params', async () => {
      // Make the runner finish immediately so the RPC call resolves.
      vi.spyOn(ConversationRunner.prototype, 'run').mockResolvedValue({
        turnId: 'turn_fake',
        stopReason: 'end_turn',
        content: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });

      await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
        track: 'slack:T123:C456/1234567890.000100',
      });

      const { events } = readDurableEvents(sessionDir, { types: ['prompt'] });
      const promptEvents = events.filter((e) => e.type === 'prompt');
      expect(promptEvents).toHaveLength(1);
      expect((promptEvents[0].data as { track?: string }).track).toBe(
        'slack:T123:C456/1234567890.000100'
      );
    });

    it('leaves track undefined on the prompt event when not passed', async () => {
      vi.spyOn(ConversationRunner.prototype, 'run').mockResolvedValue({
        turnId: 'turn_fake',
        stopReason: 'end_turn',
        content: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });

      await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      });

      const { events } = readDurableEvents(sessionDir, { types: ['prompt'] });
      const promptEvents = events.filter((e) => e.type === 'prompt');
      expect(promptEvents).toHaveLength(1);
      expect((promptEvents[0].data as { track?: string }).track).toBeUndefined();
    });
  });

  describe('ent/session/inject', () => {
    it('writes track onto the context_injected event when passed in params', async () => {
      await client.request('ent/session/inject', {
        content: [{ type: 'text', text: 'injected context' }],
        priority: 'normal',
        track: 'job:job_abc123',
      });

      const { events } = readDurableEvents(sessionDir, { types: ['context_injected'] });
      const injectedEvents = events.filter((e) => e.type === 'context_injected');
      expect(injectedEvents).toHaveLength(1);
      expect((injectedEvents[0].data as { track?: string }).track).toBe('job:job_abc123');
    });

    it('leaves track undefined on context_injected event when not passed', async () => {
      await client.request('ent/session/inject', {
        content: [{ type: 'text', text: 'injected context' }],
        priority: 'normal',
      });

      const { events } = readDurableEvents(sessionDir, { types: ['context_injected'] });
      const injectedEvents = events.filter((e) => e.type === 'context_injected');
      expect(injectedEvents).toHaveLength(1);
      expect((injectedEvents[0].data as { track?: string }).track).toBeUndefined();
    });
  });
});
