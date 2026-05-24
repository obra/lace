// ABOUTME: Regression test for session/fork write-through to the recall FTS index.
// ABOUTME: Without write-through on fork, /recall search session_id=<forked> would miss
// ABOUTME: copied events until the next process restart re-scanned via backfill.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { getRecallIndex, closeRecallIndex } from '../storage/recall/index-db';
import { invalidatePersonaCache } from '../storage/event-log';

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

describe('session/fork recall index write-through', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-fork-recall-'));
    process.env.LACE_DIR = tempDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
    invalidatePersonaCache();
  });

  afterEach(() => {
    closeRecallIndex();
    invalidatePersonaCache();

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('indexes copied events under the forked session_id in the FTS index', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());

      const created = (await client.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })) as { sessionId: string };

      // Seed a distinctive content marker the FTS index can match exactly.
      const marker = 'forkindexneedle';
      await client.request('ent/session/inject', {
        content: [{ type: 'text', text: marker }],
        priority: 'normal',
      });

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as { sessionId: string };

      // Query the FTS index directly: rows for the forked session_id must exist
      // BEFORE any process restart / backfill could have run. The fork handler
      // is the only path that could have populated them.
      const db = getRecallIndex();
      const rows = db
        .prepare(`SELECT event_id, session_id, kind FROM events WHERE session_id = ?`)
        .all(forked.sessionId) as Array<{ event_id: string; session_id: string; kind: string }>;

      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.session_id).toBe(forked.sessionId);
        expect(r.event_id.startsWith(`${forked.sessionId}:`)).toBe(true);
      }

      // The injected content_injected marker must be searchable under the
      // forked session_id.
      const matched = db
        .prepare(`SELECT event_id FROM events WHERE session_id = ? AND content MATCH ?`)
        .all(forked.sessionId, marker) as Array<{ event_id: string }>;
      expect(matched.length).toBeGreaterThan(0);
    } finally {
      client.close();
      server.close();
    }
  });
});
