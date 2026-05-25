// ABOUTME: Regression tests for ent/session/compact using the track-based strategy.
// ABOUTME: Verifies the RPC handler returns the expected response shape and
// ABOUTME: rejects unknown legacy strategy names.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
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

/**
 * Write a minimal conversation into the session's events.jsonl so that
 * ent/session/compact has something to actually compact (earlier.length > 0
 * after splitAtTailBoundary).
 *
 * We write a system_prompt_set + several message/turn_end events so that
 * buildProviderMessagesFromDurableEvents returns enough messages and the
 * track-based compaction has real events to process.
 */
function writeMinimalConversation(sessionDir: string): void {
  const eventsPath = join(sessionDir, 'events.jsonl');

  const events = [
    {
      eventSeq: 0,
      timestamp: new Date().toISOString(),
      type: 'system_prompt_set',
      data: { text: 'You are a test assistant.' },
    },
    // 12 user+assistant turn pairs to ensure earlier.length > 0 after tail split
    ...Array.from({ length: 12 }, (_, i) => [
      {
        eventSeq: 1 + i * 2,
        timestamp: new Date().toISOString(),
        type: 'message',
        data: { role: 'user', content: `User message ${i}` },
      },
      {
        eventSeq: 2 + i * 2,
        timestamp: new Date().toISOString(),
        type: 'message',
        data: { role: 'assistant', content: `Assistant reply ${i}` },
      },
    ]).flat(),
  ];

  for (const event of events) {
    appendFileSync(eventsPath, JSON.stringify(event) + '\n', { encoding: 'utf8' });
  }
}

describe('ent/session/compact — track-based strategy', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-compact-rpc-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-compact-rpc-wd-'));
    process.env.LACE_DIR = tempDir;
    // Use the test provider so createProviderForTurn doesn't need real API keys.
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;

    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns previousTokens, currentTokens, and messagesCompacted', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      const sessionDir = getSessionDir(newResult.sessionId);
      writeMinimalConversation(sessionDir);

      const result = (await client.request('ent/session/compact', {
        strategy: 'track-based',
      })) as { previousTokens: number; currentTokens: number; messagesCompacted: number };

      expect(typeof result.previousTokens).toBe('number');
      expect(typeof result.currentTokens).toBe('number');
      expect(typeof result.messagesCompacted).toBe('number');
      // Compaction should have reduced or maintained token count
      expect(result.currentTokens).toBeLessThanOrEqual(result.previousTokens);
    } finally {
      client.close();
      server.close();
    }
  });

  it('accepts no strategy (defaults to track-based)', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      // Should not throw when strategy is omitted
      const result = (await client.request('ent/session/compact', {})) as {
        previousTokens: number;
        currentTokens: number;
        messagesCompacted: number;
      };

      expect(typeof result.previousTokens).toBe('number');
      expect(typeof result.currentTokens).toBe('number');
      expect(typeof result.messagesCompacted).toBe('number');
    } finally {
      client.close();
      server.close();
    }
  });

  it('rejects legacy strategy names', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      await expect(
        client.request('ent/session/compact', { strategy: 'summarize' })
      ).rejects.toMatchObject({ message: expect.stringContaining('track-based') });
    } finally {
      client.close();
      server.close();
    }
  });
});
