// ABOUTME: Tests that the prompt handler puts the runner's
// ABOUTME: lastCallInputContextTokens on the ent-protocol wire — both the
// ABOUTME: session/update turn_end notification and the session/prompt result —
// ABOUTME: so an embedder can gate compaction on real context occupancy rather
// ABOUTME: than the turn-cumulative input+cache sum.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  createNdjsonStdioTransport,
  JsonRpcPeer,
  SessionUpdateNotificationSchema,
} from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';

type RunnerUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  lastCallInputContextTokens?: number;
  costUsd?: number;
};

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

/** Make runner.run resolve with a fixed usage payload. */
function stubRunnerUsage(usage: RunnerUsage) {
  return vi
    .spyOn(ConversationRunner.prototype, 'run')
    .mockImplementation(async (opts: { turnId: string }) => ({
      turnId: opts.turnId,
      stopReason: 'end_turn' as const,
      stopDetails: null,
      content: [{ type: 'text' as const, text: 'done' }],
      usage,
      lastSeenEventSeq: 0,
    }));
}

describe('prompt handler: lastCallInputContextTokens on the wire', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-prompt-ctx-tokens-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-prompt-ctx-tokens-wd-'));
    process.env.LACE_DIR = tempDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('carries the last call context size, distinct from the turn-cumulative sums', async () => {
    // A three-call tool loop over a ~66k context: the turn-cumulative sums add
    // up to ~200k, while the actual context the next call would send is 66,212.
    // The wire must carry the latter, or an embedder can only see the inflated
    // sum (the exact defect PRI-2945 describes).
    stubRunnerUsage({
      inputTokens: 36,
      outputTokens: 300,
      cacheCreationInputTokens: 3_600,
      cacheReadInputTokens: 195_000,
      lastCallInputContextTokens: 66_212,
      costUsd: 0.42,
    });

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const turnEnds: unknown[] = [];
    client.onRequest('session/update', async (params) => {
      if ((params as { type?: string })?.type === 'turn_end') turnEnds.push(params);
      return undefined;
    });

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      const result = (await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      })) as { usage: Record<string, unknown> };

      expect(result.usage.lastCallInputContextTokens).toBe(66_212);
      // The cumulative fields still cross unchanged — this adds a field, it
      // does not redefine the existing ones.
      expect(result.usage.cacheReadTokens).toBe(195_000);
      expect(result.usage.cacheWriteTokens).toBe(3_600);
      expect(result.usage.inputTokens).toBe(36);

      expect(turnEnds).toHaveLength(1);
      const notified = turnEnds[0] as { usage: Record<string, unknown> };
      expect(notified.usage.lastCallInputContextTokens).toBe(66_212);

      // And the notification must survive the strict wire schema a real
      // embedder parses it with.
      expect(() =>
        SessionUpdateNotificationSchema.parse({
          jsonrpc: '2.0',
          method: 'session/update',
          params: notified,
        })
      ).not.toThrow();
    } finally {
      client.close();
      server.close();
    }
  });

  it('omits the field when the runner did not report one', async () => {
    // Providers with no cache accounting (or a runner predating the field)
    // must produce a payload with the key absent, not present-and-zero: zero
    // would read as "empty context" and suppress compaction forever.
    stubRunnerUsage({ inputTokens: 36, outputTokens: 300 });

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    client.onRequest('session/update', async () => undefined);

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      const result = (await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      })) as { usage: Record<string, unknown> };

      expect('lastCallInputContextTokens' in result.usage).toBe(false);
    } finally {
      client.close();
      server.close();
    }
  });
});
