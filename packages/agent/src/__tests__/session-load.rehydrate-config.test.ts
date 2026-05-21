// ABOUTME: Tests that session/load rehydrates connectionId+modelId so the next
// session/prompt doesn't reject with "connectionId and modelId are required".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { loadSession } from '../storage/session-store';
import type { JobState } from '../server-types';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';

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
      { name: 'initial', command: process.execPath, enabled: false },
      { name: 'loaded', command: process.execPath, enabled: false },
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
      { name: 'shared', command: process.execPath, args: ['new'], enabled: false },
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
        mcpServers: [{ name: 'bad-transport', command: process.execPath, transport: 'http' }],
      })
    ).rejects.toMatchObject({ code: -32602 });

    expect(state.activeSession?.meta.sessionId).toBe(second.sessionId);
    expect(state.jobManager.getRunningJobs().get(runningJob.jobId)).toBe(runningJob);
    expect(runningJob.status).toBe('running');
  });
});
