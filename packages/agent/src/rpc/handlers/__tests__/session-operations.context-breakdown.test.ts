// ABOUTME: Regression test for PRI-1799 context-breakdown systemPrompt token accounting.
// ABOUTME: After Phase 2 of cache-control hardening, rebuilt messages never contain
// ABOUTME: role:'system' entries — the system prompt lives in the returned systemPrompt
// ABOUTME: string. This test verifies that computeContextBreakdownForActiveSession correctly
// ABOUTME: accounts for system prompt tokens by calling the real function via RPC.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';

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

describe('computeContextBreakdownForActiveSession (PRI-1799 regression)', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-ctx-breakdown-rpc-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-ctx-breakdown-wd-'));
    process.env.LACE_DIR = tempDir;

    // Avoid real provider calls; we are exercising context breakdown only.
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

  it('ent/session/context_breakdown reports non-zero systemPrompt tokens after session/new', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      const breakdown = (await client.request('ent/session/context_breakdown', {})) as {
        categories: {
          systemPrompt: { tokens: number };
          coreTools: { tokens: number };
          messages: { tokens: number };
        };
        totalUsedTokens: number;
        percentUsed: number;
      };

      // The system prompt token count must be > 0 — the PRI-1799 regression set it to 0.
      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);

      // System prompt tokens must contribute to the total (regression check).
      expect(breakdown.totalUsedTokens).toBeGreaterThanOrEqual(
        breakdown.categories.systemPrompt.tokens
      );

      // Sanity: percentUsed is in (0,1].
      expect(breakdown.percentUsed).toBeGreaterThan(0);
      expect(breakdown.percentUsed).toBeLessThanOrEqual(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('ent/session/token_usage nearLimit is false for a fresh empty session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      const usage = (await client.request('ent/session/token_usage', {})) as {
        totalPromptTokens: number;
        totalTokens: number;
        nearLimit: boolean;
        percentUsed: number;
      };

      // A fresh session with just the system prompt should not be near the limit.
      expect(usage.nearLimit).toBe(false);
      expect(usage.totalPromptTokens).toBeGreaterThan(0);
    } finally {
      client.close();
      server.close();
    }
  });
});
