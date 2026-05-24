// ABOUTME: Regression test that ent/session/compact (strategy:'summarize') calls
// ABOUTME: setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT) on the throwaway provider,
// ABOUTME: preventing getEffectiveSystemPrompt warn-fallback noise (PRI-1799).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { AIProvider } from '@lace/agent/providers/base-provider';
import { SUMMARIZER_SYSTEM_PROMPT } from '@lace/agent/compaction/summarize-strategy';
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
 * ent/session/compact has something to actually compact (dropped.length > 0).
 *
 * We write a system_prompt_set + several message/turn_end events so that
 * buildProviderMessagesFromDurableEvents returns enough messages to pass the
 * preserveRecent threshold (default 10) and still have dropped messages.
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
    // 12 user+assistant turn pairs to ensure dropped.length > 0 after preserveRecent=0
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

describe('ent/session/compact (strategy:summarize) — summarizer prompt (PRI-1799)', () => {
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

  it('calls setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT) on the throwaway provider', async () => {
    // Spy on AIProvider.prototype.setSystemPrompt — TestAgentProvider inherits it.
    const setSystemPromptSpy = vi.spyOn(AIProvider.prototype, 'setSystemPrompt');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      // Write enough conversation history that compact actually drops messages.
      const sessionDir = getSessionDir(newResult.sessionId);
      writeMinimalConversation(sessionDir);

      // Reset the spy so we only see calls from the compact handler.
      setSystemPromptSpy.mockClear();

      await client.request('ent/session/compact', {
        strategy: 'summarize',
        // preserveRecent:0 ensures ALL messages are in dropped, so the summarize
        // path is reached even for a freshly populated session.
        preserveRecent: 0,
      });

      // The compact handler must have called setSystemPrompt with the dedicated
      // summarizer prompt — not with the session's agent persona.
      expect(setSystemPromptSpy).toHaveBeenCalledWith(SUMMARIZER_SYSTEM_PROMPT);
    } finally {
      setSystemPromptSpy.mockRestore();
      client.close();
      server.close();
    }
  });
});
