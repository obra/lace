// ABOUTME: Regression test that ent/session/compact defaults to the 'summarize'
// ABOUTME: strategy when the caller omits `strategy` (PRI-1824). Truncate is a
// ABOUTME: near-no-op on prose-heavy sessions, so the default must be summarize.

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

function writeMinimalConversation(sessionDir: string): void {
  const eventsPath = join(sessionDir, 'events.jsonl');

  const events = [
    {
      eventSeq: 0,
      timestamp: new Date().toISOString(),
      type: 'system_prompt_set',
      data: { text: 'You are a test assistant.' },
    },
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

describe('ent/session/compact — default strategy (PRI-1824)', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-compact-default-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-compact-default-wd-'));
    process.env.LACE_DIR = tempDir;
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

  it('defaults to summarize when strategy is omitted', async () => {
    // setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT) is only invoked on the summarize
    // path. Spying on it lets us prove the default reaches summarize without
    // depending on any particular wire enum string.
    const setSystemPromptSpy = vi.spyOn(AIProvider.prototype, 'setSystemPrompt');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      const sessionDir = getSessionDir(newResult.sessionId);
      writeMinimalConversation(sessionDir);

      setSystemPromptSpy.mockClear();

      // No `strategy` field — exercise the default path.
      await client.request('ent/session/compact', {
        preserveRecent: 0,
      });

      expect(setSystemPromptSpy).toHaveBeenCalledWith(SUMMARIZER_SYSTEM_PROMPT);
    } finally {
      setSystemPromptSpy.mockRestore();
      client.close();
      server.close();
    }
  });

  it('defaults to summarize when params is omitted entirely', async () => {
    const setSystemPromptSpy = vi.spyOn(AIProvider.prototype, 'setSystemPrompt');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      const sessionDir = getSessionDir(newResult.sessionId);
      // Write more events so preserveRecent's default (10) still leaves dropped > 0.
      writeMinimalConversation(sessionDir);
      // Add 8 more user/assistant pairs (24 events total here + 1 system prompt)
      // to comfortably exceed preserveRecent=10.
      const eventsPath = join(sessionDir, 'events.jsonl');
      for (let i = 12; i < 20; i++) {
        for (const ev of [
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
        ]) {
          appendFileSync(eventsPath, JSON.stringify(ev) + '\n', { encoding: 'utf8' });
        }
      }

      setSystemPromptSpy.mockClear();

      await client.request('ent/session/compact');

      expect(setSystemPromptSpy).toHaveBeenCalledWith(SUMMARIZER_SYSTEM_PROMPT);
    } finally {
      setSystemPromptSpy.mockRestore();
      client.close();
      server.close();
    }
  });
});
