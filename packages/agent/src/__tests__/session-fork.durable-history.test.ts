import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { loadSession, writeSessionState } from '../storage/session-store';
import { buildDefaultBoundedHostRuntimeBinding } from '../tools/runtime/validation';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
import { logger } from '@lace/agent/utils/logger';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';

/**
 * Walk the transcripts/<persona>/<date>/<sessionId>.jsonl tree to read a
 * forked session's events from the new persona/date layout.
 */
function readSessionEventsFromDisk(laceDir: string, sessionId: string): string[] {
  const root = join(laceDir, 'transcripts');
  if (!existsSync(root)) return [];
  for (const persona of readdirSync(root)) {
    const personaDir = join(root, persona);
    for (const date of readdirSync(personaDir)) {
      const candidate = join(personaDir, date, `${sessionId}.jsonl`);
      if (existsSync(candidate)) {
        return readFileSync(candidate, 'utf8').trim().split('\n').filter(Boolean);
      }
    }
  }
  return [];
}

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

describe('session/fork durable history', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-test-'));
    process.env.LACE_DIR = tempDir;

    // Avoid real provider calls; we are only exercising session + durable storage.
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('copies all durable events when forking a session (including > 100)', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());

      const created = (await client.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })) as any;
      expect(created).toMatchObject({ sessionId: expect.any(String), created: expect.any(String) });

      // Create enough durable events to exceed readDurableEvents default limit (100).
      const injectedCount = 120;
      for (let i = 0; i < injectedCount; i++) {
        await client.request('ent/session/inject', {
          content: [{ type: 'text', text: `event_${i}` }],
          priority: 'normal',
        });
      }

      const sourceEventsResult = (await client.request('ent/session/events', {
        afterEventSeq: 0,
        limit: 2000,
      })) as any;
      expect(sourceEventsResult.hasMore).toBe(false);

      const sourceEvents = sourceEventsResult.events as any[];
      expect(sourceEvents.length).toBeGreaterThan(100);
      const sourceLast = sourceEvents.at(-1);
      expect(sourceLast).toMatchObject({ type: 'context_injected' });
      expect(sourceLast.data).toMatchObject({
        content: [{ type: 'text', text: `event_${injectedCount - 1}` }],
      });

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as any;
      expect(forked).toMatchObject({
        sessionId: expect.any(String),
        forkedFrom: created.sessionId,
      });

      await client.request('session/load', {
        sessionId: forked.sessionId,
        cwd: process.cwd(),
        mcpServers: [],
      });
      const forkedEventsResult = (await client.request('ent/session/events', {
        afterEventSeq: 0,
        limit: 2000,
      })) as any;
      expect(forkedEventsResult.hasMore).toBe(false);

      const forkedEvents = forkedEventsResult.events as any[];
      expect(forkedEvents.length).toBe(sourceEvents.length);
      expect(forkedEvents.at(-1)).toMatchObject({
        eventSeq: sourceLast.eventSeq,
        type: sourceLast.type,
        data: sourceLast.data,
      });
    } finally {
      client.close();
      server.close();
    }
  });

  it('rebuilds runtime binding identity and cwd when forking to a new cwd', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const sourceCwd = join(tempDir, 'source');
    const forkedCwd = join(tempDir, 'forked');
    const sourceRuntimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_source_session' },
      toolRuntime: { type: 'boundedHost', root: sourceCwd, cwd: sourceCwd },
    };

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: sourceCwd,
        mcpServers: [],
        config: { runtimeBinding: sourceRuntimeBinding },
      })) as { sessionId: string };

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        cwd: forkedCwd,
      })) as { sessionId: string };

      expect(loadSession(created.sessionId).state.config?.runtimeBinding).toEqual(
        sourceRuntimeBinding
      );
      expect(loadSession(forked.sessionId).state.config?.runtimeBinding).toEqual(
        buildDefaultBoundedHostRuntimeBinding({ sessionId: forked.sessionId, cwd: forkedCwd })
      );
    } finally {
      client.close();
      server.close();
    }
  });

  it('defaults direct MCP override placement when forking a session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      })) as { sessionId: string };

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        mcpServers: [
          { name: 'missing-transport', command: 'mcp-default' },
          { name: 'stdio-transport', command: 'mcp-stdio', transport: 'stdio' },
          { name: 'http-transport', command: 'mcp-http', transport: 'http' },
          { name: 'sse-transport', command: 'mcp-sse', transport: 'sse' },
          {
            name: 'explicit-host',
            command: 'mcp-explicit',
            transport: 'stdio',
            placement: 'host',
          },
        ],
      })) as { sessionId: string };

      expect(loadSession(forked.sessionId).state.config?.mcpServers).toEqual([
        {
          name: 'missing-transport',
          command: 'mcp-default',
          placement: 'toolRuntime',
          source: 'embedder',
        },
        {
          name: 'stdio-transport',
          command: 'mcp-stdio',
          transport: 'stdio',
          placement: 'toolRuntime',
          source: 'embedder',
        },
        {
          name: 'http-transport',
          command: 'mcp-http',
          transport: 'http',
          placement: 'host',
          source: 'embedder',
        },
        {
          name: 'sse-transport',
          command: 'mcp-sse',
          transport: 'sse',
          placement: 'host',
          source: 'embedder',
        },
        {
          name: 'explicit-host',
          command: 'mcp-explicit',
          transport: 'stdio',
          placement: 'host',
          source: 'embedder',
        },
      ]);
    } finally {
      client.close();
      server.close();
    }
  });

  it('defaults legacy source MCP placement when forking without overrides', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      })) as { sessionId: string };
      const source = loadSession(created.sessionId);
      writeSessionState(source.dir, {
        ...source.state,
        config: {
          ...source.state.config,
          mcpServers: [
            { name: 'legacy-stdio', command: 'mcp-stdio' },
            { name: 'legacy-http', command: 'mcp-http', transport: 'http' },
          ],
        },
      });

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as { sessionId: string };

      expect(loadSession(forked.sessionId).state.config?.mcpServers).toEqual([
        { name: 'legacy-stdio', command: 'mcp-stdio', placement: 'toolRuntime' },
        { name: 'legacy-http', command: 'mcp-http', transport: 'http', placement: 'host' },
      ]);
    } finally {
      client.close();
      server.close();
    }
  });

  it('writes exactly one system_prompt_set event when forking to a different cwd (Fix #9)', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    const sourceCwd = join(tempDir, 'source-cwd');
    const forkedCwd = join(tempDir, 'forked-cwd');
    mkdirSync(sourceCwd, { recursive: true });
    mkdirSync(forkedCwd, { recursive: true });

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: sourceCwd,
        mcpServers: [],
      })) as { sessionId: string };

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        cwd: forkedCwd,
      })) as { sessionId: string };

      // Read the forked session's transcript via the persona/date layout.
      const allEvents = readSessionEventsFromDisk(tempDir, forked.sessionId).map(
        (line) => JSON.parse(line) as { type: string; data: { text?: string } }
      );

      const systemPromptEvents = allEvents.filter((e) => e.type === 'system_prompt_set');

      // Exactly ONE system_prompt_set event: the source's copy is skipped, replaced
      // by the fresh re-rendered one for the new cwd.
      expect(systemPromptEvents.length).toBe(1);

      // The sole event's text must reference forkedCwd, not sourceCwd.
      const onlySystemPrompt = systemPromptEvents[0]!;
      expect(onlySystemPrompt.data.text).toContain(forkedCwd);
      expect(onlySystemPrompt.data.text).not.toContain(sourceCwd);
    } finally {
      client.close();
      server.close();
    }
  });

  it('does NOT append an extra system_prompt_set event when forking to the same cwd (Fix #9)', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      })) as { sessionId: string };

      // Fork without providing cwd — defaults to source's workDir, so no re-render.
      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as { sessionId: string };

      const allEvents = readSessionEventsFromDisk(tempDir, forked.sessionId).map(
        (line) => JSON.parse(line) as { type: string }
      );

      const systemPromptEvents = allEvents.filter((e) => e.type === 'system_prompt_set');

      // Same cwd: only one system_prompt_set event (the cloned one, no re-render needed).
      expect(systemPromptEvents.length).toBe(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('uses sourceSession persona (not hardcoded "lace") on cwd-refresh', async () => {
    // A custom persona with a unique identifying string that does not appear in
    // any lace shared section.  We write it into a temp personas directory so
    // the personaRegistry can resolve it without touching the source tree.
    const personasDir = join(tempDir, 'custom-personas');
    mkdirSync(personasDir, { recursive: true });
    // Distinctive marker that appears only in this persona, not in lace.
    const personaMarker = 'FORK_TEST_PERSONA_UNIQUE_MARKER_XQ9Z';
    writeFileSync(
      join(personasDir, 'fork-test.md'),
      `You are a fork-test agent.\n${personaMarker}`
    );

    const sourceCwd = join(tempDir, 'source-cwd');
    const forkedCwd = join(tempDir, 'forked-cwd');
    mkdirSync(sourceCwd, { recursive: true });
    mkdirSync(forkedCwd, { recursive: true });

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      // Register the custom personas directory so the registry can resolve 'fork-test'.
      await client.request(
        'initialize',
        defaultInitializeParams({}, { userPersonasPaths: [personasDir] })
      );

      // Create the source session with the non-lace persona.
      const created = (await client.request('session/new', {
        cwd: sourceCwd,
        mcpServers: [],
        persona: 'fork-test',
      })) as { sessionId: string };

      // Fork to a different cwd — triggers the cwd-refresh / re-render path.
      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        cwd: forkedCwd,
      })) as { sessionId: string };

      // Read all events from the forked session's transcript (persona/date layout).
      const allEvents = readSessionEventsFromDisk(tempDir, forked.sessionId).map(
        (line) => JSON.parse(line) as { type: string; data: { text?: string } }
      );

      const systemPromptEvents = allEvents.filter((e) => e.type === 'system_prompt_set');

      // Exactly ONE system_prompt_set event: the source's copy is skipped, replaced
      // by the fresh re-rendered one for the new cwd.
      expect(systemPromptEvents.length).toBe(1);

      // The sole re-rendered event must use the fork-test persona text, not lace's.
      const onlyPrompt = systemPromptEvents[0]!;
      expect(onlyPrompt.data.text).toContain(personaMarker);
      // Lace's identity text appears in lace but not in fork-test persona.
      expect(onlyPrompt.data.text).not.toContain('You are Lace, a pragmatic AI partner');
    } finally {
      client.close();
      server.close();
    }
  });

  it('does NOT trigger message-builder "invariant violation" warn when forking to a different cwd', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    const sourceCwd = join(tempDir, 'source-cwd');
    const forkedCwd = join(tempDir, 'forked-cwd');
    mkdirSync(sourceCwd, { recursive: true });
    mkdirSync(forkedCwd, { recursive: true });

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: sourceCwd,
        mcpServers: [],
      })) as { sessionId: string };

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        cwd: forkedCwd,
      })) as { sessionId: string };

      const forkedDir = join(tempDir, 'agent-sessions', forked.sessionId);

      // Rebuild the forked session (as happens on every prompt/compact/etc.) and
      // assert no "invariant violation" warn is emitted.
      buildProviderMessagesFromDurableEvents(forkedDir);

      const violationWarns = warnSpy.mock.calls.filter((args) =>
        String(args[0] ?? '').includes('invariant violation')
      );
      expect(violationWarns).toHaveLength(0);

      // Also assert exactly one system_prompt_set event in the on-disk transcript.
      const events = readSessionEventsFromDisk(tempDir, forked.sessionId).map(
        (line) => JSON.parse(line) as { type: string }
      );
      const sysPromptEvents = events.filter((e) => e.type === 'system_prompt_set');
      expect(sysPromptEvents).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
      client.close();
      server.close();
    }
  });

  it('inherits the source session persona on session/fork', async () => {
    const userPersonasDir = join(tempDir, 'personas');
    mkdirSync(userPersonasDir, { recursive: true });
    writeFileSync(join(userPersonasDir, 'forkpersona.md'), 'You are forkpersona.');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
      );

      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
        persona: 'forkpersona',
      })) as { sessionId: string };
      expect(loadSession(created.sessionId).meta.persona).toBe('forkpersona');

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as { sessionId: string };

      expect(loadSession(forked.sessionId).meta.persona).toBe('forkpersona');
    } finally {
      client.close();
      server.close();
    }
  });
});
