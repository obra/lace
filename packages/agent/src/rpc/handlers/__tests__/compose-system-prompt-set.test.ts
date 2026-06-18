// ABOUTME: Unit tests for composeAndWriteSystemPromptSet's skip-if-unchanged
// ABOUTME: behavior — re-rendering an identical persona prompt appends nothing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  createAgentServerState,
  registerAgentRpcMethods,
  createToolExecutorForMode,
} from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { getSessionDir, readSessionState } from '@lace/agent/storage/session-store';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import { composeAndWriteSystemPromptSet } from '../session';

function systemPromptTexts(sessionDir: string): string[] {
  const events = readDurableEvents(sessionDir, { limit: Number.MAX_SAFE_INTEGER }).events as Array<{
    type: string;
    data?: { text?: string };
  }>;
  return events.filter((e) => e.type === 'system_prompt_set').map((e) => e.data?.text ?? '');
}

describe('composeAndWriteSystemPromptSet — skip-if-unchanged', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-compose-sps-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-compose-sps-wd-'));
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

  it('does not append a second event when re-rendering the same persona prompt', async () => {
    const state = createAgentServerState();
    const aToB = new PassThrough();
    const bToA = new PassThrough();
    const client = new JsonRpcPeer(createNdjsonStdioTransport({ readable: bToA, writable: aToB }), {
      idPrefix: 'c_',
    });
    const server = new JsonRpcPeer(createNdjsonStdioTransport({ readable: aToB, writable: bToA }), {
      idPrefix: 'a_',
    });
    registerAgentRpcMethods(server, state);

    try {
      await client.request('initialize', defaultInitializeParams());
      const { sessionId } = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'lace',
      })) as { sessionId: string };
      const sessionDir = getSessionDir(sessionId);

      // session/new already wrote exactly one system_prompt_set.
      const afterNew = systemPromptTexts(sessionDir);
      expect(afterNew.length).toBe(1);
      const personaPrompt = afterNew[0]!;

      // Re-render with the SAME persona/cwd → byte-identical prompt → no append.
      await composeAndWriteSystemPromptSet({
        sessionDir,
        sessionState: readSessionState(sessionDir),
        persona: 'lace',
        cwd: workDir,
        state,
        createToolExecutorForMode,
      });

      const afterRerender = systemPromptTexts(sessionDir);
      expect(afterRerender.length).toBe(1);
      expect(afterRerender[0]).toBe(personaPrompt);

      // A second identical re-render still appends nothing.
      await composeAndWriteSystemPromptSet({
        sessionDir,
        sessionState: readSessionState(sessionDir),
        persona: 'lace',
        cwd: workDir,
        state,
        createToolExecutorForMode,
      });
      expect(systemPromptTexts(sessionDir).length).toBe(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('appends a new event when the rendered prompt changes (different cwd)', async () => {
    const state = createAgentServerState();
    const aToB = new PassThrough();
    const bToA = new PassThrough();
    const client = new JsonRpcPeer(createNdjsonStdioTransport({ readable: bToA, writable: aToB }), {
      idPrefix: 'c_',
    });
    const server = new JsonRpcPeer(createNdjsonStdioTransport({ readable: aToB, writable: bToA }), {
      idPrefix: 'a_',
    });
    registerAgentRpcMethods(server, state);

    const otherWorkDir = mkdtempSync(join(tmpdir(), 'lace-compose-sps-wd2-'));

    try {
      await client.request('initialize', defaultInitializeParams());
      const { sessionId } = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'lace',
      })) as { sessionId: string };
      const sessionDir = getSessionDir(sessionId);

      const afterNew = systemPromptTexts(sessionDir);
      expect(afterNew.length).toBe(1);

      // Re-render with a DIFFERENT cwd → the prompt embeds the new cwd → it
      // differs from the latest event → a new system_prompt_set is appended.
      await composeAndWriteSystemPromptSet({
        sessionDir,
        sessionState: readSessionState(sessionDir),
        persona: 'lace',
        cwd: otherWorkDir,
        state,
        createToolExecutorForMode,
      });

      const after = systemPromptTexts(sessionDir);
      expect(after.length).toBe(2);
      expect(after[1]).not.toBe(after[0]);
    } finally {
      client.close();
      server.close();
      rmSync(otherWorkDir, { recursive: true, force: true });
    }
  });
});
