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
import { readDurableEvents } from '@lace/agent/storage/event-log';

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
 * Write a realistic conversation into the session's events.jsonl so that
 * ent/session/compact has something to actually compact (earlier.length > 0
 * after splitAtTailBoundary).
 *
 * Each turn follows the correct structure: prompt → turn_start → message → turn_end.
 * splitAtTailBoundary walks backwards counting turn_end events; without them
 * all events end up in the tail and messagesCompacted = 0.
 * We write 12 turns to ensure > 10 (TAIL_TURNS) end up in earlier[].
 */
function writeMinimalConversation(sessionDir: string): void {
  const eventsPath = join(sessionDir, 'events.jsonl');

  const ts = new Date().toISOString();
  const events: object[] = [
    {
      eventSeq: 0,
      timestamp: ts,
      type: 'system_prompt_set',
      data: { type: 'system_prompt_set', text: 'You are a test assistant.' },
    },
  ];

  // 20 turns: prompt → turn_start → message → turn_end
  // This ensures earlier.length > 0 after splitAtTailBoundary(events, 10).
  // 20 turns means 10 go to "earlier" and 10 to tail. The 10 earlier turns
  // get replaced by a short prefix, which should reduce total token count.
  // Content is intentionally verbose so the earlier→prefix token reduction
  // exceeds the small compaction header overhead.
  const userText = (i: number) =>
    `User message ${i}: Please help me understand the implications of the recent architectural changes to the system. ` +
    `Specifically, I am concerned about the performance characteristics and the scalability of the new approach. ` +
    `Can you provide a detailed analysis with concrete recommendations? This is turn number ${i} of our discussion.`;
  const assistantText = (i: number) =>
    `Assistant reply ${i}: Based on my analysis, the architectural changes you mentioned have several important implications. ` +
    `The new approach improves modularity but introduces some performance overhead in the critical path. ` +
    `My recommendation is to profile the hot paths first before optimizing. Here are the key considerations for turn ${i}.`;

  for (let i = 0; i < 20; i++) {
    const base = 1 + i * 4;
    const turnId = `turn_${i}`;
    events.push(
      {
        eventSeq: base,
        timestamp: ts,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: userText(i) }] },
      },
      {
        eventSeq: base + 1,
        timestamp: ts,
        type: 'turn_start',
        turnId,
        data: { type: 'turn_start' },
      },
      {
        eventSeq: base + 2,
        timestamp: ts,
        type: 'message',
        turnId,
        data: { type: 'message', content: assistantText(i) },
      },
      {
        eventSeq: base + 3,
        timestamp: ts,
        type: 'turn_end',
        turnId,
        data: { type: 'turn_end', stopReason: 'end_turn' },
      }
    );
  }

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
      })) as {
        previousTokens: number;
        currentTokens: number;
        messagesCompacted: number;
        strategy?: string;
      };

      expect(typeof result.previousTokens).toBe('number');
      expect(typeof result.currentTokens).toBe('number');
      expect(typeof result.messagesCompacted).toBe('number');
      // The result echoes the strategy lace actually resolved and ran.
      expect(result.strategy).toBe('track-based');
      // Compaction should have folded the 10 earlier turns (20 total - 10 tail)
      expect(result.messagesCompacted).toBeGreaterThan(0);
      // Untracked content is re-rendered verbatim in the prefix, so currentTokens
      // may be slightly higher than previousTokens due to compaction header overhead.
      // Verify the token counts are in the same ballpark (within 10% of each other).
      expect(result.currentTokens).toBeLessThan(result.previousTokens * 1.1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('re-renders the system prompt from the current persona after compaction', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      const sessionDir = getSessionDir(newResult.sessionId);
      writeMinimalConversation(sessionDir);

      await client.request('ent/session/compact', { strategy: 'track-based' });

      const events = readDurableEvents(sessionDir, { limit: Number.MAX_SAFE_INTEGER })
        .events as Array<{ type: string; data?: { text?: string } }>;

      const compactIdx = events.findIndex((e) => e.type === 'context_compacted');
      expect(compactIdx).toBeGreaterThanOrEqual(0);

      // A fresh system_prompt_set is appended AFTER the compaction event, and it
      // is the re-rendered persona — not the stale one the conversation carried.
      const sysAfter = events.slice(compactIdx).filter((e) => e.type === 'system_prompt_set');
      expect(sysAfter.length).toBeGreaterThan(0);
      expect(sysAfter.at(-1)?.data?.text).not.toBe('You are a test assistant.');
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
        strategy?: string;
      };

      expect(typeof result.previousTokens).toBe('number');
      expect(typeof result.currentTokens).toBe('number');
      expect(typeof result.messagesCompacted).toBe('number');
      // With no strategy requested, lace resolves the session-configured strategy
      // and reports it back — never empty, never invented.
      expect(result.strategy).toBe('track-based');
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
