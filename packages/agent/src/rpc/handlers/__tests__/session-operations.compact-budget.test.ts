// ABOUTME: Test that ent/session/compact includes systemPrompt tokens in previousTokens
// ABOUTME: and in the budget loop comparison (PRI-1799 follow-up, Task 4).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { getSessionDir } from '@lace/agent/storage/session-store';
import { estimateTokens } from '@lace/agent/utils/token-estimation';

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
 * Write a conversation with a large system prompt and several message pairs.
 * The system prompt is large enough that its token contribution is measurable.
 */
function writeConversationWithLargeSystemPrompt(
  sessionDir: string,
  systemPromptText: string
): void {
  const eventsPath = join(sessionDir, 'events.jsonl');

  const events = [
    {
      eventSeq: 0,
      timestamp: new Date().toISOString(),
      type: 'system_prompt_set',
      data: { text: systemPromptText },
    },
    // 12 user+assistant pairs so there are dropped messages (> default preserveRecent=10)
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

describe('ent/session/compact — systemPrompt token inclusion (PRI-1799 Task 4)', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-compact-budget-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-compact-budget-wd-'));
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

  it('previousTokens reflects messages PLUS the systemPrompt tokens', async () => {
    // A large system prompt whose token contribution is easily distinguishable.
    // Repeating 50 times gives ~200-300 tokens, well above message-token noise.
    const systemPromptText = 'You are TestPersona. '.repeat(50);
    const expectedSystemPromptTokens = estimateTokens(systemPromptText);
    // Sanity-check: the system prompt must actually be non-trivial
    expect(expectedSystemPromptTokens).toBeGreaterThan(50);

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      const sessionDir = getSessionDir(newResult.sessionId);
      writeConversationWithLargeSystemPrompt(sessionDir, systemPromptText);

      const response = (await client.request('ent/session/compact', {
        strategy: 'truncate',
        // preserveRecent:0 to maximise dropped messages; avoids needing a real LLM.
        preserveRecent: 0,
      })) as { previousTokens: number; currentTokens: number; messagesCompacted: number };

      // previousTokens must be strictly greater than the system prompt alone
      // (i.e., it includes both the system prompt AND the message tokens).
      expect(response.previousTokens).toBeGreaterThan(expectedSystemPromptTokens);

      // The value must also be AT LEAST the system prompt's contribution.
      // Before the fix, previousTokens was message-only (no system prompt),
      // so it would typically be LESS than expectedSystemPromptTokens for this
      // small conversation. After the fix it must be GREATER.
      //
      // Compute the message-only baseline using the same estimator logic:
      // 12 pairs × 2 messages × ~5 tokens each ≈ 120 tokens.
      // expectedSystemPromptTokens ≈ 250 tokens. So pre-fix previousTokens < expectedSystemPromptTokens.
      // This assertion distinguishes the fixed from the broken behaviour.
      const messageOnlyBaseline = 12 * 2 * 5; // conservative upper bound
      // If the fix is absent, previousTokens ≈ messageOnlyBaseline < expectedSystemPromptTokens.
      // If the fix is present, previousTokens ≥ expectedSystemPromptTokens + some message tokens.
      expect(response.previousTokens).toBeGreaterThanOrEqual(expectedSystemPromptTokens);
    } finally {
      client.close();
      server.close();
    }
  });

  it('currentTokens includes systemPromptTokens for comparability with previousTokens', async () => {
    // A large system prompt whose token contribution is easily distinguishable.
    const systemPromptText = 'You are TestPersona. '.repeat(50);
    const expectedSystemPromptTokens = estimateTokens(systemPromptText);
    expect(expectedSystemPromptTokens).toBeGreaterThan(50);

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };

      const sessionDir = getSessionDir(newResult.sessionId);
      writeConversationWithLargeSystemPrompt(sessionDir, systemPromptText);

      const response = (await client.request('ent/session/compact', {
        strategy: 'truncate',
        preserveRecent: 0,
      })) as { previousTokens: number; currentTokens: number; messagesCompacted: number };

      // currentTokens must be >= the system prompt's token count.
      // Without the fix, currentTokens would exclude systemPromptTokens and be
      // much smaller (e.g., ~60 tokens for 12 messages vs ~250 for system prompt).
      // With the fix, currentTokens >= expectedSystemPromptTokens.
      expect(response.currentTokens).toBeGreaterThanOrEqual(expectedSystemPromptTokens);

      // Both previousTokens and currentTokens should include the system prompt.
      // The difference (previousTokens - currentTokens) represents only the
      // compacted and removed message tokens, not the system prompt.
      // Both must be >= system prompt tokens for the math to make sense.
      expect(response.previousTokens).toBeGreaterThanOrEqual(expectedSystemPromptTokens);
      expect(response.currentTokens).toBeGreaterThanOrEqual(expectedSystemPromptTokens);
    } finally {
      client.close();
      server.close();
    }
  });
});
