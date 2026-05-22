// ABOUTME: Tests that session/load rehydrates connectionId+modelId so the next
// session/prompt doesn't reject with "connectionId and modelId are required".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { loadSession, writeSessionState } from '../storage/session-store';
import { reconcileMcpServersForActiveSession } from '../rpc/handlers/mcp-servers';
import type { JobState } from '../server-types';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
import { mcpConnectionKey } from '../mcp/server-manager';

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

describe('session/load rehydrates connectionId+modelId from persisted state', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-session-load-cfg-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function workspaceRuntimeBinding(cwd: string): RuntimeExecutionBinding {
    return {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_workspace_session' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'workspace',
        projectRoot: tempDir,
        workspaceRoot: tempDir,
        cwd,
      },
    };
  }

  function containerAgentRuntimeBinding(cwd: string): RuntimeExecutionBinding {
    return {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_container_agent_session' },
      agentPlacement: 'container',
      toolRuntime: { type: 'local', cwd },
    };
  }

  function persistRuntimeBinding(sessionId: string, runtimeBinding: RuntimeExecutionBinding): void {
    const loaded = loadSession(sessionId);
    writeSessionState(loaded.dir, {
      ...loaded.state,
      config: {
        ...loaded.state.config,
        runtimeBinding,
      },
    });
  }

  function activeHostMcpConnectionKey(
    serverId: string,
    transport: 'stdio' | 'http' | 'sse',
    sessionId: string
  ): string {
    return mcpConnectionKey({
      serverId,
      config: { placement: 'host', transport },
      runtimeId: `session:${sessionId}:host`,
      hostCwd: tempDir,
    });
  }

  function activeToolRuntimeMcpConnectionKey(
    serverId: string,
    transport: 'stdio' | 'http' | 'sse',
    sessionId: string
  ): string {
    return mcpConnectionKey({
      serverId,
      config: { placement: 'toolRuntime', transport },
      runtimeId: `session:${sessionId}:host`,
      runtimeCwd: tempDir,
      hostCwd: tempDir,
    });
  }

  it('rehydrates state.config.connectionId and modelId after session/load', async () => {
    // Step 1: bring up a server, configure connectionId+modelId, create a session
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request(
      'initialize',
      defaultInitializeParams({
        config: { connectionId: 'conn_test', modelId: 'model_test' },
      })
    );
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [{ name: 'initial', command: process.execPath, enabled: false }],
    })) as { sessionId: string };

    // Step 2: simulate a process restart. New state, new initialize. Embedder
    // does NOT replay connectionId/modelId in initialize (a realistic ent
    // boot path — the persisted session is supposed to own that).
    const loadState = createAgentServerState();
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());
    await loadClient.request('session/load', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [{ name: 'loaded', command: process.execPath, enabled: false }],
    });

    // Step 3: after load, the persisted connectionId+modelId must be
    // rehydrated into state.config. Prompting depends on this — the
    // turn factory rejects when state.config.connectionId/modelId
    // (read via the effective-config merge) is missing, and embedders
    // shouldn't have to re-bind values the session already knows.
    expect(loadState.activeSession?.state.config?.connectionId).toBe('conn_test');
    expect(loadState.activeSession?.state.config?.modelId).toBe('model_test');
    expect(loadState.config.connectionId).toBe('conn_test');
    expect(loadState.config.modelId).toBe('model_test');
    expect(loadState.activeSession?.state.config?.mcpServers).toEqual([
      { name: 'initial', command: process.execPath, enabled: false, placement: 'toolRuntime' },
      { name: 'loaded', command: process.execPath, enabled: false, placement: 'toolRuntime' },
    ]);
  });

  it('preserves the stored session cwd when loading from another directory', async () => {
    const projectDir = join(tempDir, 'project-a');
    const callerDir = join(tempDir, 'project-b');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(callerDir, { recursive: true });

    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: projectDir,
      mcpServers: [],
    })) as { sessionId: string };

    const loadState = createAgentServerState();
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());
    await loadClient.request('session/load', {
      sessionId: created.sessionId,
      cwd: callerDir,
      mcpServers: [],
    });

    expect(loadState.activeSession?.meta.workDir).toBe(projectDir);
    expect(loadSession(created.sessionId).meta.workDir).toBe(projectDir);
  });

  it('resumes a session without replaying history and reapplies session MCP servers', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request(
      'initialize',
      defaultInitializeParams({
        config: { connectionId: 'conn_test', modelId: 'model_test' },
      })
    );
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [{ name: 'shared', command: process.execPath, args: ['old'], enabled: false }],
    })) as { sessionId: string };

    const resumeState = createAgentServerState();
    const { client: resumeClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, resumeState)
    );
    const updates: unknown[] = [];
    resumeClient.onRequest('session/update', (params) => {
      updates.push(params);
      return undefined;
    });

    await resumeClient.request('initialize', defaultInitializeParams());
    const result = await resumeClient.request('session/resume', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [{ name: 'shared', command: process.execPath, args: ['new'], enabled: false }],
    });

    expect(result).toEqual({});
    expect(updates).toEqual([]);
    expect(resumeState.activeSession?.state.config?.connectionId).toBe('conn_test');
    expect(resumeState.activeSession?.state.config?.modelId).toBe('model_test');
    expect(resumeState.config.connectionId).toBe('conn_test');
    expect(resumeState.config.modelId).toBe('model_test');
    expect(resumeState.activeSession?.state.config?.mcpServers).toEqual([
      {
        name: 'shared',
        command: process.execPath,
        args: ['new'],
        enabled: false,
        placement: 'toolRuntime',
      },
    ]);
  });

  it('persists runtimeBinding passed during session/resume', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const runtimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_resume_inherited' },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: tempDir },
    };
    const resumeState = createAgentServerState();
    const { client: resumeClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, resumeState)
    );

    await resumeClient.request('initialize', defaultInitializeParams());
    await resumeClient.request('session/resume', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [],
      config: { runtimeBinding },
    });

    expect(resumeState.activeSession?.state.config?.runtimeBinding).toEqual(runtimeBinding);
    expect(loadSession(created.sessionId).state.config?.runtimeBinding).toEqual(runtimeBinding);
  });

  it('persists non-local runtimeBinding during session/new', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const runtimeBinding = workspaceRuntimeBinding(tempDir);

    await client.request('initialize', defaultInitializeParams());

    const created = (await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
      config: { runtimeBinding },
    })) as { sessionId: string };

    expect(state.activeSession?.state.config?.runtimeBinding).toEqual(runtimeBinding);
    expect(loadSession(created.sessionId).state.config?.runtimeBinding).toEqual(runtimeBinding);
  });

  it('persists non-local runtimeBinding during session/resume', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const resumeState = createAgentServerState();
    const { client: resumeClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, resumeState)
    );

    await resumeClient.request('initialize', defaultInitializeParams());
    const runtimeBinding = workspaceRuntimeBinding(tempDir);
    await resumeClient.request('session/resume', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [],
      config: { runtimeBinding },
    });

    expect(loadSession(created.sessionId).state.config?.runtimeBinding).toEqual(runtimeBinding);
    expect(resumeState.activeSession?.state.config?.runtimeBinding).toEqual(runtimeBinding);
  });

  it('persists non-local runtimeBinding during session/load', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const loadState = createAgentServerState();
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());
    const runtimeBinding = workspaceRuntimeBinding(tempDir);
    await loadClient.request('session/load', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [],
      config: { runtimeBinding },
    });

    expect(loadSession(created.sessionId).state.config?.runtimeBinding).toEqual(runtimeBinding);
    expect(loadState.activeSession?.state.config?.runtimeBinding).toEqual(runtimeBinding);
  });

  it.each(['session/new', 'session/load', 'session/resume'] as const)(
    'rejects container-agent runtimeBinding during %s',
    async (method) => {
      const setupState = createAgentServerState();
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, setupState));

      await client.request('initialize', defaultInitializeParams());
      const created =
        method === 'session/new'
          ? undefined
          : ((await client.request('session/new', {
              cwd: tempDir,
              mcpServers: [],
            })) as { sessionId: string });

      await expect(
        client.request(method, {
          ...(created ? { sessionId: created.sessionId } : {}),
          cwd: tempDir,
          mcpServers: [],
          config: { runtimeBinding: containerAgentRuntimeBinding(tempDir) },
        })
      ).rejects.toMatchObject({ code: -32602 });
    }
  );

  it('activates stored non-local runtimeBinding during session/load', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };
    const storedRuntimeBinding = workspaceRuntimeBinding(tempDir);
    persistRuntimeBinding(created.sessionId, storedRuntimeBinding);

    const loadState = createAgentServerState();
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());
    await loadClient.request('session/load', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [{ name: 'loaded', command: process.execPath, enabled: false }],
    });

    expect(loadState.activeSession?.state.config).toMatchObject({
      runtimeBinding: storedRuntimeBinding,
    });
    expect(loadSession(created.sessionId).state.config).toMatchObject({
      runtimeBinding: storedRuntimeBinding,
    });
    expect(loadSession(created.sessionId).state.config?.mcpServers).toEqual([
      { name: 'loaded', command: process.execPath, enabled: false, placement: 'toolRuntime' },
    ]);
  });

  it('activates stored non-local runtimeBinding during session/resume', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };
    const storedRuntimeBinding = workspaceRuntimeBinding(tempDir);
    persistRuntimeBinding(created.sessionId, storedRuntimeBinding);

    const resumeState = createAgentServerState();
    const { client: resumeClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, resumeState)
    );

    await resumeClient.request('initialize', defaultInitializeParams());
    await resumeClient.request('session/resume', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [{ name: 'resumed', command: process.execPath, enabled: false }],
    });

    expect(resumeState.activeSession?.state.config).toMatchObject({
      runtimeBinding: storedRuntimeBinding,
    });
    expect(loadSession(created.sessionId).state.config).toMatchObject({
      runtimeBinding: storedRuntimeBinding,
    });
    expect(loadSession(created.sessionId).state.config?.mcpServers).toEqual([
      { name: 'resumed', command: process.execPath, enabled: false, placement: 'toolRuntime' },
    ]);
  });

  it('rejects stored container-agent runtimeBinding during session/load', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };
    persistRuntimeBinding(created.sessionId, containerAgentRuntimeBinding(tempDir));

    const loadState = createAgentServerState();
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());

    await expect(
      loadClient.request('session/load', {
        sessionId: created.sessionId,
        cwd: tempDir,
        mcpServers: [],
      })
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('persists HTTP/SSE MCP configs without spawning them as stdio during load', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const loadState = createAgentServerState();
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());
    await loadClient.request('session/load', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [
        {
          name: 'http-server',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          transport: 'http',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        },
        {
          name: 'sse-server',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          transport: 'sse',
        },
      ],
    });

    expect(loadState.activeSession?.state.config?.mcpServers).toEqual([
      {
        name: 'http-server',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        transport: 'http',
        secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        placement: 'host',
      },
      {
        name: 'sse-server',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        transport: 'sse',
        placement: 'host',
      },
    ]);
    expect(loadState.mcpServerManager.getServer('http-server')).toMatchObject({
      id: 'http-server',
      status: 'failed',
      lastError: 'Unsupported MCP transport: http',
      config: expect.objectContaining({ transport: 'http', placement: 'host' }),
    });
    expect(loadState.mcpServerManager.getServer('sse-server')).toMatchObject({
      id: 'sse-server',
      status: 'failed',
      lastError: 'Unsupported MCP transport: sse',
      config: expect.objectContaining({ transport: 'sse', placement: 'host' }),
    });
  });

  it('preserves MCP transport, placement, and secretEnv when reconciling stdio servers', async () => {
    const setupState = createAgentServerState();
    const { client: setupClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, setupState)
    );

    await setupClient.request('initialize', defaultInitializeParams());
    const created = (await setupClient.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const loadState = createAgentServerState();
    const startServer = vi
      .spyOn(loadState.mcpServerManager, 'startServer')
      .mockResolvedValue(undefined);
    const { client: loadClient } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, loadState)
    );

    await loadClient.request('initialize', defaultInitializeParams());
    await loadClient.request('session/load', {
      sessionId: created.sessionId,
      cwd: tempDir,
      mcpServers: [
        {
          name: 'stdio-host',
          command: process.execPath,
          transport: 'stdio',
          placement: 'host',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        },
      ],
    });

    expect(startServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'stdio-host',
        config: {
          command: process.execPath,
          transport: 'stdio',
          placement: 'host',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
          enabled: true,
          tools: {},
        },
        hostCwd: tempDir,
        runtime: expect.objectContaining({ cwd: tempDir }),
      })
    );
  });

  it('upserts MCP configs with placement defaults and preserves transport metadata', async () => {
    const state = createAgentServerState();
    const startServer = vi
      .spyOn(state.mcpServerManager, 'startServer')
      .mockResolvedValue(undefined);
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    await client.request('ent/mcp/servers/upsert', {
      name: 'remote-http',
      command: process.execPath,
      transport: 'http',
      secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
      enabled: true,
    });

    expect(loadSession(created.sessionId).state.config?.mcpServers).toEqual([
      {
        name: 'remote-http',
        command: process.execPath,
        transport: 'http',
        secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
        enabled: true,
        placement: 'host',
      },
    ]);
    expect(startServer).not.toHaveBeenCalled();

    await client.request('ent/mcp/servers/upsert', {
      name: 'local-stdio',
      command: process.execPath,
      transport: 'stdio',
      placement: 'host',
      enabled: true,
    });

    expect(startServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'local-stdio',
        config: {
          command: process.execPath,
          transport: 'stdio',
          placement: 'host',
          enabled: true,
          tools: {},
        },
        hostCwd: tempDir,
        runtime: expect.objectContaining({ cwd: tempDir }),
      })
    );
  });

  it('restarts enabled MCP upserts when same-key config changes', async () => {
    const state = createAgentServerState();
    const startServer = vi
      .spyOn(state.mcpServerManager, 'startServer')
      .mockResolvedValue(undefined);
    const stopServer = vi.spyOn(state.mcpServerManager, 'stopServer');
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    });

    const connectionKey = activeHostMcpConnectionKey(
      'local-stdio',
      'stdio',
      state.activeSession!.meta.sessionId
    );
    state.mcpServerManager.registerConnection('local-stdio', {
      id: 'local-stdio',
      connectionKey,
      config: {
        command: process.execPath,
        transport: 'stdio',
        placement: 'host',
        env: { MODE: 'old' },
        enabled: true,
        tools: {},
      },
      status: 'running',
    });

    await client.request('ent/mcp/servers/upsert', {
      name: 'local-stdio',
      command: process.execPath,
      transport: 'stdio',
      placement: 'host',
      env: { MODE: 'new' },
      enabled: true,
    });

    expect(stopServer).toHaveBeenCalledWith(connectionKey);
    expect(startServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'local-stdio',
        config: expect.objectContaining({
          env: { MODE: 'new' },
        }),
      })
    );
  });

  it('stops an existing running MCP server when upserted as disabled', async () => {
    const state = createAgentServerState();
    const startServer = vi
      .spyOn(state.mcpServerManager, 'startServer')
      .mockResolvedValue(undefined);
    const stopServer = vi.spyOn(state.mcpServerManager, 'stopServer');
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const connectionKey = activeHostMcpConnectionKey(
      'local-stdio',
      'stdio',
      state.activeSession!.meta.sessionId
    );
    state.mcpServerManager.registerConnection('local-stdio', {
      id: 'local-stdio',
      connectionKey,
      config: {
        command: process.execPath,
        transport: 'stdio',
        placement: 'host',
        enabled: true,
        tools: {},
      },
      status: 'running',
    });

    await client.request('ent/mcp/servers/upsert', {
      name: 'local-stdio',
      command: process.execPath,
      transport: 'stdio',
      placement: 'host',
      enabled: false,
    });

    expect(loadSession(created.sessionId).state.config?.mcpServers).toEqual([
      {
        name: 'local-stdio',
        command: process.execPath,
        transport: 'stdio',
        placement: 'host',
        enabled: false,
      },
    ]);
    expect(stopServer).toHaveBeenCalledWith(connectionKey);
    expect(startServer).not.toHaveBeenCalled();
    expect(state.mcpServerManager.getServer(connectionKey)).toMatchObject({
      status: 'stopped',
      config: expect.objectContaining({
        enabled: false,
      }),
    });
  });

  it('removes deleted MCP servers from manager state', async () => {
    const state = createAgentServerState();
    const startServer = vi
      .spyOn(state.mcpServerManager, 'startServer')
      .mockResolvedValue(undefined);
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const initial = (await client.request('ent/mcp/servers/upsert', {
      name: 'deleted-server',
      command: process.execPath,
      transport: 'stdio',
      placement: 'host',
      enabled: false,
    })) as { created: boolean };

    expect(initial.created).toBe(true);
    expect(state.mcpServerManager.getServer('deleted-server')).toBeDefined();

    await client.request('ent/mcp/servers/delete', {
      serverId: 'deleted-server',
    });

    expect(loadSession(created.sessionId).state.config?.mcpServers).toEqual([]);
    expect(state.mcpServerManager.getServer('deleted-server')).toBeUndefined();

    const list = (await client.request('ent/mcp/servers/list', {})) as {
      servers: Array<{ serverId: string }>;
    };
    expect(list.servers).toEqual([]);

    const recreated = (await client.request('ent/mcp/servers/upsert', {
      name: 'deleted-server',
      command: process.execPath,
      transport: 'stdio',
      placement: 'host',
      enabled: false,
    })) as { created: boolean };

    expect(recreated.created).toBe(true);
    expect(startServer).not.toHaveBeenCalled();
  });

  it('removes stale same-id connections when an enabled upsert changes placement', async () => {
    const state = createAgentServerState();
    const startServer = vi
      .spyOn(state.mcpServerManager, 'startServer')
      .mockResolvedValue(undefined);
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    });

    const hostKey = activeHostMcpConnectionKey(
      'local-stdio',
      'stdio',
      state.activeSession!.meta.sessionId
    );
    state.mcpServerManager.registerConnection('local-stdio', {
      id: 'local-stdio',
      connectionKey: hostKey,
      config: {
        command: process.execPath,
        transport: 'stdio',
        placement: 'host',
        enabled: true,
        tools: {},
      },
      status: 'running',
    });

    await client.request('ent/mcp/servers/upsert', {
      name: 'local-stdio',
      command: process.execPath,
      transport: 'stdio',
      placement: 'toolRuntime',
      enabled: true,
    });

    expect(state.mcpServerManager.getServer(hostKey)).toBeUndefined();
    expect(startServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'local-stdio',
        config: expect.objectContaining({
          placement: 'toolRuntime',
        }),
      })
    );
  });

  it('does not start unrelated configured MCP servers during single-server upsert', async () => {
    const state = createAgentServerState();
    const startServer = vi
      .spyOn(state.mcpServerManager, 'startServer')
      .mockImplementation(async (input) => {
        if (input.serverId === 'broken-server') {
          throw new Error('unrelated server should not start');
        }
      });
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    });

    writeSessionState(state.activeSession!.dir, {
      ...state.activeSession!.state,
      config: {
        ...state.activeSession!.state.config,
        mcpServers: [
          {
            name: 'broken-server',
            command: process.execPath,
            transport: 'stdio',
            placement: 'host',
            enabled: true,
            secretEnv: {
              TOKEN: { namespace: 'project', name: 'missing-token' },
            },
          },
        ],
      },
    });
    state.activeSession = loadSession(state.activeSession!.meta.sessionId);

    await client.request('ent/mcp/servers/upsert', {
      name: 'target-server',
      command: process.execPath,
      transport: 'stdio',
      placement: 'host',
      enabled: true,
    });

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'target-server',
      })
    );
    expect(loadSession(state.activeSession!.meta.sessionId).state.config?.mcpServers).toEqual([
      {
        name: 'broken-server',
        command: process.execPath,
        transport: 'stdio',
        placement: 'host',
        enabled: true,
        secretEnv: {
          TOKEN: { namespace: 'project', name: 'missing-token' },
        },
      },
      {
        name: 'target-server',
        command: process.execPath,
        transport: 'stdio',
        placement: 'host',
        enabled: true,
      },
    ]);
  });

  it.each(['http', 'sse'] as const)(
    'stops an existing running stdio server when upserted to unsupported %s transport',
    async (transport) => {
      const state = createAgentServerState();
      const startServer = vi
        .spyOn(state.mcpServerManager, 'startServer')
        .mockResolvedValue(undefined);
      const stopServer = vi.spyOn(state.mcpServerManager, 'stopServer');
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      })) as { sessionId: string };

      const hostStdioKey = activeHostMcpConnectionKey(
        'remote-server',
        'stdio',
        state.activeSession!.meta.sessionId
      );
      state.mcpServerManager.registerConnection('remote-server', {
        id: 'remote-server',
        connectionKey: hostStdioKey,
        config: {
          command: process.execPath,
          transport: 'stdio',
          enabled: true,
          tools: {},
        },
        status: 'running',
      });

      await client.request('ent/mcp/servers/upsert', {
        name: 'remote-server',
        command: process.execPath,
        transport,
        enabled: true,
      });

      expect(loadSession(created.sessionId).state.config?.mcpServers).toEqual([
        {
          name: 'remote-server',
          command: process.execPath,
          transport,
          enabled: true,
          placement: 'host',
        },
      ]);
      expect(stopServer).toHaveBeenCalledWith('remote-server');
      expect(state.mcpServerManager.getServer('remote-server')?.status).toBe('failed');
      expect(state.mcpServerManager.getServer('remote-server')?.lastError).toBe(
        `Unsupported MCP transport: ${transport}`
      );
      expect(startServer).not.toHaveBeenCalled();
    }
  );

  it.each(['http', 'sse'] as const)(
    'does not start unsupported %s MCP transport when testing a server',
    async (transport) => {
      const state = createAgentServerState();
      const startServer = vi
        .spyOn(state.mcpServerManager, 'startServer')
        .mockResolvedValue(undefined);
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams());
      state.mcpServerManager.registerConnection('remote-server', {
        id: 'remote-server',
        config: {
          command: process.execPath,
          transport,
          enabled: true,
          tools: {},
        },
        status: 'stopped',
      });

      const result = (await client.request('ent/mcp/servers/test', {
        serverId: 'remote-server',
      })) as { ok: boolean; error?: string };

      expect(result).toMatchObject({
        ok: false,
        error: `Unsupported MCP transport for test: ${transport}`,
      });
      expect(startServer).not.toHaveBeenCalled();
    }
  );

  it.each(['http', 'sse'] as const)(
    'represents a fresh unsupported %s MCP transport as failed for list and test',
    async (transport) => {
      const state = createAgentServerState();
      const startServer = vi
        .spyOn(state.mcpServerManager, 'startServer')
        .mockResolvedValue(undefined);
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      });

      await client.request('ent/mcp/servers/upsert', {
        name: 'remote-server',
        command: process.execPath,
        transport,
        enabled: true,
      });

      const server = state.mcpServerManager.getServer('remote-server');
      expect(server?.status).toBe('failed');
      expect(server?.lastError).toBe(`Unsupported MCP transport: ${transport}`);
      expect(server?.config.transport).toBe(transport);
      expect(server?.connectionKey).toBe(
        activeHostMcpConnectionKey('remote-server', transport, state.activeSession!.meta.sessionId)
      );

      const list = (await client.request('ent/mcp/servers/list', {})) as {
        servers: Array<{ serverId: string; status: string; lastError?: string }>;
      };
      expect(list.servers).toEqual([
        expect.objectContaining({
          serverId: 'remote-server',
          status: 'failed',
          lastError: `Unsupported MCP transport: ${transport}`,
        }),
      ]);

      const result = (await client.request('ent/mcp/servers/test', {
        serverId: 'remote-server',
      })) as { ok: boolean; error?: string };

      expect(result).toMatchObject({
        ok: false,
        error: `Unsupported MCP transport for test: ${transport}`,
      });
      expect(startServer).not.toHaveBeenCalled();
    }
  );

  it('does not expose internal MCP connection keys in server list results', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    state.mcpServerManager.registerConnection('visible-server', {
      id: 'visible-server',
      config: {
        command: process.execPath,
        transport: 'stdio',
        enabled: true,
        tools: {},
      },
      status: 'running',
    });

    const result = (await client.request('ent/mcp/servers/list', {})) as {
      servers: Array<Record<string, unknown>>;
    };

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      serverId: 'visible-server',
      name: 'visible-server',
      command: process.execPath,
      enabled: true,
      status: 'running',
    });
    expect(result.servers[0]).not.toHaveProperty('connectionKey');
  });

  it.each(['http', 'sse'] as const)(
    'does not restart stale stdio config after upserting a running server to unsupported %s transport',
    async (transport) => {
      const state = createAgentServerState();
      const startServer = vi
        .spyOn(state.mcpServerManager, 'startServer')
        .mockResolvedValue(undefined);
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      });

      const hostStdioKey = activeHostMcpConnectionKey(
        'remote-server',
        'stdio',
        state.activeSession!.meta.sessionId
      );
      state.mcpServerManager.registerConnection('remote-server', {
        id: 'remote-server',
        connectionKey: hostStdioKey,
        config: {
          command: process.execPath,
          transport: 'stdio',
          enabled: true,
          tools: {},
        },
        status: 'running',
      });

      await client.request('ent/mcp/servers/upsert', {
        name: 'remote-server',
        command: process.execPath,
        transport,
        enabled: true,
      });
      startServer.mockClear();
      expect(state.mcpServerManager.getServer('remote-server')?.config.transport).toBe(transport);
      expect(state.mcpServerManager.getServer('remote-server')?.connectionKey).toBe(
        activeHostMcpConnectionKey('remote-server', transport, state.activeSession!.meta.sessionId)
      );

      const result = (await client.request('ent/mcp/servers/test', {
        serverId: 'remote-server',
      })) as { ok: boolean; error?: string };

      expect(result).toMatchObject({
        ok: false,
        error: `Unsupported MCP transport for test: ${transport}`,
      });
      expect(startServer).not.toHaveBeenCalled();
    }
  );

  it.each(['http', 'sse'] as const)(
    'stops stale runtime-placed stdio config after upserting to unsupported %s transport',
    async (transport) => {
      const state = createAgentServerState();
      const startServer = vi
        .spyOn(state.mcpServerManager, 'startServer')
        .mockResolvedValue(undefined);
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      });

      const runtimeStdioKey = activeToolRuntimeMcpConnectionKey(
        'remote-server',
        'stdio',
        state.activeSession!.meta.sessionId
      );
      state.mcpServerManager.registerConnection('remote-server', {
        id: 'remote-server',
        connectionKey: runtimeStdioKey,
        config: {
          command: process.execPath,
          transport: 'stdio',
          placement: 'toolRuntime',
          enabled: true,
          tools: {},
        },
        status: 'running',
      });

      await client.request('ent/mcp/servers/upsert', {
        name: 'remote-server',
        command: process.execPath,
        transport,
        enabled: true,
      });

      const hostUnsupportedKey = activeHostMcpConnectionKey(
        'remote-server',
        transport,
        state.activeSession!.meta.sessionId
      );
      expect(state.mcpServerManager.getServer(runtimeStdioKey)).toBeUndefined();
      expect(state.mcpServerManager.getServer(hostUnsupportedKey)?.status).toBe('failed');
      expect(state.mcpServerManager.getServer(hostUnsupportedKey)?.lastError).toBe(
        `Unsupported MCP transport: ${transport}`
      );
      expect(state.mcpServerManager.getServer(hostUnsupportedKey)?.config.transport).toBe(
        transport
      );
      expect(state.mcpServerManager.getAllServers()).toHaveLength(1);
      expect(startServer).not.toHaveBeenCalled();
    }
  );

  it.each(['http', 'sse'] as const)(
    'does not restart stale stdio config after reconciling a running server to unsupported %s transport',
    async (transport) => {
      const state = createAgentServerState();
      const startServer = vi
        .spyOn(state.mcpServerManager, 'startServer')
        .mockResolvedValue(undefined);
      const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      });

      const hostStdioKey = activeHostMcpConnectionKey(
        'remote-server',
        'stdio',
        state.activeSession!.meta.sessionId
      );
      state.mcpServerManager.registerConnection('remote-server', {
        id: 'remote-server',
        connectionKey: hostStdioKey,
        config: {
          command: process.execPath,
          transport: 'stdio',
          enabled: true,
          tools: {},
        },
        status: 'running',
      });

      writeSessionState(state.activeSession!.dir, {
        ...state.activeSession!.state,
        config: {
          ...state.activeSession!.state.config,
          mcpServers: [
            {
              name: 'remote-server',
              command: process.execPath,
              transport,
              placement: 'host',
              enabled: true,
            },
          ],
        },
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      await reconcileMcpServersForActiveSession(state);
      startServer.mockClear();
      expect(state.mcpServerManager.getServer('remote-server')?.config.transport).toBe(transport);
      expect(state.mcpServerManager.getServer('remote-server')?.connectionKey).toBe(
        activeHostMcpConnectionKey('remote-server', transport, state.activeSession!.meta.sessionId)
      );

      const result = (await client.request('ent/mcp/servers/test', {
        serverId: 'remote-server',
      })) as { ok: boolean; error?: string };

      expect(result).toMatchObject({
        ok: false,
        error: `Unsupported MCP transport for test: ${transport}`,
      });
      expect(startServer).not.toHaveBeenCalled();
    }
  );

  it('keeps the current session and jobs when load rejects invalid MCP servers', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const first = (await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };
    const second = (await client.request('session/new', {
      cwd: tempDir,
      mcpServers: [],
    })) as { sessionId: string };

    const runningJob: JobState = {
      jobId: 'job_current',
      type: 'bash',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: join(tempDir, 'job_current.log'),
      finished: false,
      completion: new Promise(() => undefined),
      resolveCompletion: () => undefined,
    };
    state.jobManager.getRunningJobs().set(runningJob.jobId, runningJob);

    await expect(
      client.request('session/load', {
        sessionId: first.sessionId,
        cwd: tempDir,
        mcpServers: [{ name: 'missing-command' }],
      })
    ).rejects.toMatchObject({ code: -32602 });

    expect(state.activeSession?.meta.sessionId).toBe(second.sessionId);
    expect(state.jobManager.getRunningJobs().get(runningJob.jobId)).toBe(runningJob);
    expect(runningJob.status).toBe('running');
  });
});
