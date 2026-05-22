// ABOUTME: Tests for initialize userPersonasPaths + session/new persona config application

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { loadSession } from '../storage/session-store';
import { defaultInitializeParams } from './helpers/initialize';

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

describe('initialize userPersonasPaths + session/new persona config', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;
  let userPersonasDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-persona-cfg-'));
    process.env.LACE_DIR = tempDir;
    userPersonasDir = join(tempDir, 'custom-personas');
    mkdirSync(userPersonasDir, { recursive: true });
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses userPersonasPaths from initialize for persona resolution', async () => {
    writeFileSync(join(userPersonasDir, 'librarian.md'), 'You are a librarian.');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const result = (await client.request('ent/personas/list')) as {
      personas: Array<{ name: string; isUserDefined: boolean }>;
    };
    const names = result.personas.map((p) => p.name);
    expect(names).toContain('librarian');
  });

  it('applies persona frontmatter (model, mcpServers, tools) to session config', async () => {
    writeFileSync(
      join(userPersonasDir, 'frontmatter.md'),
      `---
model: claude-3-5-sonnet
tools:
  - file_read
  - bash
mcpServers:
  fs:
    command: mcp-fs
    args: ['--root', '/tmp']
    enabled: false
---
You are a frontmatter persona.`
    );

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'frontmatter',
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.state.config?.modelId).toBe('claude-3-5-sonnet');
    // Persona tools are additive over lace builtins. file_read and bash are
    // both builtins and persona-declared, so they appear once in the union.
    expect(loaded.state.config?.toolScope).toContain('file_read');
    expect(loaded.state.config?.toolScope).toContain('bash');
    expect(loaded.state.config?.toolScope).toContain('ripgrep_search'); // builtin
    expect(loaded.state.config?.mcpServers).toEqual([
      {
        name: 'fs',
        command: 'mcp-fs',
        args: ['--root', '/tmp'],
        enabled: false,
        placement: 'toolRuntime',
        source: 'embedder',
      },
    ]);
  });

  it('merges request MCP servers with persona defaults by server name', async () => {
    writeFileSync(
      join(userPersonasDir, 'merged-mcp.md'),
      `---
mcpServers:
  shared:
    command: persona-shared
    args: ['persona-arg']
    enabled: false
  persona-only:
    command: persona-only
    enabled: false
---
You are a persona with MCP defaults.`
    );

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'merged-mcp',
      mcpServers: [
        { name: 'shared', command: 'request-shared', enabled: false },
        { name: 'request-only', command: 'request-only', enabled: false },
      ],
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.state.config?.mcpServers).toEqual([
      {
        name: 'shared',
        command: 'request-shared',
        enabled: false,
        placement: 'toolRuntime',
        source: 'embedder',
      },
      {
        name: 'persona-only',
        command: 'persona-only',
        enabled: false,
        placement: 'toolRuntime',
        source: 'embedder',
      },
      {
        name: 'request-only',
        command: 'request-only',
        enabled: false,
        placement: 'toolRuntime',
        source: 'embedder',
      },
    ]);
  });

  it('preserves persona MCP transport, placement, and secret environment references', async () => {
    writeFileSync(
      join(userPersonasDir, 'persona-mcp-placement.md'),
      `---
mcpServers:
  remote-http:
    command: remote-http
    transport: http
    secretEnv:
      API_KEY:
        namespace: project
        name: api-key
    enabled: true
  explicit-stdio-host:
    command: stdio-host
    transport: stdio
    placement: host
    enabled: false
---
Persona with MCP placement.`
    );

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'persona-mcp-placement',
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.state.config?.mcpServers).toEqual([
      {
        name: 'remote-http',
        command: 'remote-http',
        transport: 'http',
        secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        enabled: true,
        placement: 'host',
        source: 'embedder',
      },
      {
        name: 'explicit-stdio-host',
        command: 'stdio-host',
        transport: 'stdio',
        placement: 'host',
        enabled: false,
        source: 'embedder',
      },
    ]);
  });

  it('body-only persona applies no config defaults', async () => {
    writeFileSync(join(userPersonasDir, 'bodyonly.md'), 'You are a body-only persona.');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'bodyonly',
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.state.config?.modelId).toBeUndefined();
    expect(loaded.state.config?.toolScope).toBeUndefined();
    expect(loaded.state.config?.mcpServers).toBeUndefined();
  });

  it('request-level config.modelId overrides persona model default', async () => {
    writeFileSync(
      join(userPersonasDir, 'modelpersona.md'),
      `---
model: persona-default-model
---
persona body`
    );

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'modelpersona',
      config: { modelId: 'request-wins-model' },
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.state.config?.modelId).toBe('request-wins-model');
  });

  it('unknown persona returns a clear error', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    await expect(
      client.request('session/new', { cwd: tempDir, mcpServers: [], persona: 'does-not-exist' })
    ).rejects.toMatchObject({
      message: expect.stringContaining('does-not-exist'),
    });
  });

  it('persona tools flow into session toolScope (cache key reflects scope)', async () => {
    writeFileSync(
      join(userPersonasDir, 'scoped.md'),
      `---
tools:
  - file_read
---
scoped persona`
    );

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'scoped',
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    // Persona tools are additive over lace builtins — file_read is a builtin
    // so it is already included; the scope is the union, deduplicated.
    expect(loaded.state.config?.toolScope).toContain('file_read');
    // Builtins are always present even when persona names only a subset.
    expect(loaded.state.config?.toolScope).toContain('bash');
    expect(loaded.state.config?.toolScope).toContain('ripgrep_search');
  });

  it('persona tools are additive over lace builtins (MCP-only persona keeps builtins)', async () => {
    // Models the kata-#31 scenario: a persona declares only specialized
    // (e.g. MCP-namespaced) tools. Lace builtins are part of the platform and
    // MUST remain available so the subagent can read files, search, etc.
    writeFileSync(
      join(userPersonasDir, 'mcponly.md'),
      `---
tools:
  - knowledge/grep
---
mcp-only persona`
    );

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'mcponly',
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    const scope = loaded.state.config?.toolScope ?? [];
    // Persona-declared tool present.
    expect(scope).toContain('knowledge/grep');
    // Lace builtins always present.
    expect(scope).toContain('file_read');
    expect(scope).toContain('ripgrep_search');
    expect(scope).toContain('bash');
    expect(scope).toContain('file_write');
    expect(scope).toContain('delegate');
    // No duplicates from the union.
    expect(new Set(scope).size).toBe(scope.length);
  });
});
