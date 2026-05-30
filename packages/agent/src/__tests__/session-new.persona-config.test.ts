// ABOUTME: Tests for initialize userPersonasPaths + session/new persona config application

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  createAgentServerState,
  registerAgentRpcMethods,
  createToolExecutorForMode,
} from '../server';
import { loadSession } from '../storage/session-store';
import { defaultInitializeParams } from './helpers/initialize';
import type { JobManager } from '../jobs/job-manager';
import type { JobState } from '../server-types';

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
    // Persona tools: is the verbatim allowlist (Claude Code semantics).
    // The persona declares file_read and bash, so toolScope is exactly those two.
    expect(loaded.state.config?.toolScope).toEqual(['file_read', 'bash']);
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

  it('rejects persona with leading dash even if a matching file exists', async () => {
    // Seed a persona file matching the invalid name so PersonaNotFoundError
    // can't be the reason for the rejection — the shape check must fire first.
    writeFileSync(join(userPersonasDir, '-evil.md'), 'evil');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    await expect(
      client.request('session/new', { cwd: tempDir, persona: '-evil' })
    ).rejects.toThrow();
  });

  it('rejects persona with whitespace even if a matching file exists', async () => {
    writeFileSync(join(userPersonasDir, 'two words.md'), 'words');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    await expect(
      client.request('session/new', { cwd: tempDir, persona: 'two words' })
    ).rejects.toThrow();
  });

  it('rejects persona with leading/trailing whitespace (not silently coerced)', async () => {
    // Seed a file at the trimmed name so the only way the request can succeed
    // is if validation runs against the trimmed string instead of the raw one.
    // The raw input "  ada  " MUST be rejected on whitespace shape, not
    // accepted as "ada".
    writeFileSync(join(userPersonasDir, 'ada.md'), 'You are ada.');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    await expect(
      client.request('session/new', { cwd: tempDir, persona: '  ada  ' })
    ).rejects.toThrow();
  });

  it('rejects all-whitespace persona (not silently dropped)', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    // "   " is whitespace-only. Trimming would collapse to "" and the old
    // toNonEmptyString-then-validate flow silently dropped it (treated as
    // "no persona"). The validator must reject it as a malformed name.
    await expect(client.request('session/new', { cwd: tempDir, persona: '   ' })).rejects.toThrow();
  });

  it('rejects _unknown sentinel as persona even if a matching file exists', async () => {
    writeFileSync(join(userPersonasDir, '_unknown.md'), 'sentinel');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    await expect(
      client.request('session/new', { cwd: tempDir, persona: '_unknown' })
    ).rejects.toThrow();
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
    // Persona tools: is the verbatim allowlist (Claude Code semantics).
    // The persona declares only file_read, so toolScope is exactly that.
    expect(loaded.state.config?.toolScope).toEqual(['file_read']);
  });

  it('persists the requested persona name in session meta.json', async () => {
    writeFileSync(join(userPersonasDir, 'recall-persona.md'), 'You are a recall persona.');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'recall-persona',
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.meta.persona).toBe('recall-persona');
  });

  it('persists nested config.persona in session meta.json', async () => {
    writeFileSync(join(userPersonasDir, 'nested-persona.md'), 'You are a nested persona.');

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
      config: { persona: 'nested-persona' },
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.meta.persona).toBe('nested-persona');
  });

  it('omits persona from meta.json when none is supplied', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );

    const created = (await client.request('session/new', {
      cwd: tempDir,
    })) as { sessionId: string };

    const loaded = loadSession(created.sessionId);
    expect(loaded.meta.persona).toBeUndefined();
  });

  it('persona tools: is verbatim allowlist — MCP-only persona gets only declared tools', async () => {
    // PRI-1900: persona tools: is now a complete allowlist, not additive.
    // A persona that declares only MCP-namespaced tools gets exactly those;
    // if it also needs builtins it must list them explicitly.
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
    // Exact allowlist: only the declared tool, no implicit builtins.
    expect(loaded.state.config?.toolScope).toEqual(['knowledge/grep']);
  });

  it('allowlist: persona tools: is the exact toolScope (no implicit builtins)', async () => {
    writeFileSync(
      join(userPersonasDir, 'narrow.md'),
      '---\ntools:\n  - bash\n---\nYou are narrow.'
    );
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );
    const { sessionId } = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'narrow',
    })) as { sessionId: string };
    const session = loadSession(sessionId);
    expect(session.state.config?.toolScope).toEqual(['bash']);
  });

  it('allowlist: empty tools: yields zero tools', async () => {
    writeFileSync(join(userPersonasDir, 'notools.md'), '---\ntools: []\n---\nYou have no tools.');
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );
    const { sessionId } = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'notools',
    })) as { sessionId: string };
    const session = loadSession(sessionId);
    expect(session.state.config?.toolScope).toEqual([]);
  });

  it('omitted tools: inherits all (no toolScope stored)', async () => {
    writeFileSync(join(userPersonasDir, 'wide.md'), '---\n---\nYou inherit all tools.');
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    await client.request(
      'initialize',
      defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
    );
    const { sessionId } = (await client.request('session/new', {
      cwd: tempDir,
      persona: 'wide',
    })) as { sessionId: string };
    const session = loadSession(sessionId);
    expect(session.state.config?.toolScope).toBeUndefined();
  });

  describe('session/new always persists personaName', () => {
    it('default-persona (no persona specified) session has config.personaName === "lace"', async () => {
      const state = createAgentServerState();
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams({}));

      // Create a session WITHOUT specifying persona.
      const created = (await client.request('session/new', {
        cwd: tempDir,
      })) as { sessionId: string };

      const loaded = loadSession(created.sessionId);
      expect(loaded.state.config?.personaName).toBe('lace');
    });

    it('explicit-persona session has config.personaName === that persona', async () => {
      writeFileSync(join(userPersonasDir, 'custom.md'), 'You are a custom persona.');

      const state = createAgentServerState();
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request(
        'initialize',
        defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
      );

      // Create a session WITH persona='custom'.
      const created = (await client.request('session/new', {
        cwd: tempDir,
        persona: 'custom',
      })) as { sessionId: string };

      const loaded = loadSession(created.sessionId);
      expect(loaded.state.config?.personaName).toBe('custom');
    });
  });

  describe('PRI-1911 regression: state.personaRegistry (set by initialize) reaches DelegateTool', () => {
    // This test guards the full wiring chain:
    //   initialize(userPersonasPaths=[D]) → state.personaRegistry
    //   → createToolExecutorForMode(state.personaRegistry)
    //   → ToolExecutor.registerAllAvailableTools({ personaRegistry })
    //   → new DelegateTool({ personaRegistry })
    //   → this.personaRegistry.parsePersona(...)
    //
    // Without this wiring, DelegateTool falls back to the module-level
    // defaultPersonaRegistry whose userPersonasPaths = [<LACE_DIR>/agent-personas],
    // and persona files placed only in the embedder-supplied D are invisible.

    it('delegate tool created via state.personaRegistry resolves a persona in the embedder-supplied dir', async () => {
      // Place a persona ONLY in our custom dir, not in the default LACE_DIR/agent-personas.
      const customPersonaName = 'delegate-wiring-regression';
      writeFileSync(join(userPersonasDir, `${customPersonaName}.md`), 'Regression persona body.');

      // Boot the server and run initialize with our custom dir.
      const state = createAgentServerState();
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request(
        'initialize',
        defaultInitializeParams({}, { userPersonasPaths: [userPersonasDir] })
      );

      // state.personaRegistry is now built from userPersonasDir.
      // Use createToolExecutorForMode the same way the prompt handler does.
      const { executor } = await createToolExecutorForMode(
        'execute',
        undefined, // no MCP
        undefined, // no jobManager — use DelegateTool.execute directly with a mock
        undefined, // no skillRegistry
        undefined, // no toolScope
        state.personaRegistry
      );

      const delegate = executor.getTool('delegate');
      expect(delegate).toBeDefined();

      // Use background:true so the tool returns immediately after createJob
      // without waiting for job completion.
      const mockJobManager: JobManager = {
        createJob: vi.fn().mockResolvedValue({
          jobId: 'job_pri1911',
          job: {
            jobId: 'job_pri1911',
            type: 'delegate' as const,
            status: 'running' as const,
            // Never-resolving completion is safe: background:true returns
            // immediately on createJob and the test never awaits this promise.
            completion: new Promise<void>(() => {}),
          } as unknown as JobState,
        }),
        listJobs: vi.fn().mockReturnValue([]),
      } as unknown as JobManager;

      const result = await delegate!.execute(
        { prompt: 'hello', persona: customPersonaName, background: true },
        { signal: new AbortController().signal, jobManager: mockJobManager }
      );

      // If wiring is broken, DelegateTool falls back to defaultPersonaRegistry
      // (which sees LACE_DIR/agent-personas, not userPersonasDir) and returns
      // status:'failed' with a PersonaNotFoundError message.
      expect(result.status).toBe('completed');
      expect(mockJobManager.createJob).toHaveBeenCalledWith(
        'delegate',
        expect.objectContaining({ persona: customPersonaName })
      );
    });
  });
});
