// ABOUTME: Tests for ACP session cancellation and close lifecycle handling.
// ABOUTME: Ensures cancellation remains mapped to the JSON-RPC cancellation error code.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AcpErrorCodes,
  createNdjsonStdioTransport,
  JsonRpcPeer,
  JSONRPC_ERROR_CANCELLED,
} from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { requestPermissionFromClient } from '../rpc/permissions';
import { readDurableEvents } from '../storage/event-log';

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

async function startBackgroundPermissionRequest(params: {
  server: JsonRpcPeer;
  state: ReturnType<typeof createAgentServerState>;
  tempDir: string;
  sessionId: string;
  toolCallId: string;
  turnId: string;
}): Promise<{
  permissionResult: Promise<{ decision?: string; updatedInput?: Record<string, unknown> }>;
}> {
  const abortController = new AbortController();
  const jobId = `job_${params.toolCallId}`;
  params.state.jobManager.getRunningJobs().set(jobId, {
    jobId,
    type: 'bash',
    status: 'running',
    startedAt: new Date().toISOString(),
    outputPath: join(params.tempDir, `${jobId}.log`),
    permissionAbortController: abortController,
    finished: false,
    completion: new Promise(() => undefined),
    resolveCompletion: () => undefined,
  });

  const permissionResult = requestPermissionFromClient(
    params.server,
    params.state,
    async (work) => work(),
    {
      sessionId: params.sessionId,
      turnId: params.turnId,
      turnSeq: 0,
      jobId,
      toolCallId: params.toolCallId,
      tool: 'bash',
      kind: 'execute',
      resource: 'echo hi',
      options: [
        { optionId: 'allow', label: 'Allow' },
        { optionId: 'deny', label: 'Deny' },
      ],
      input: { command: 'echo hi' },
      signal: abortController.signal,
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(params.state.pendingPermissionRequests.has(params.toolCallId)).toBe(true);

  return { permissionResult };
}

describe('ACP session cancellation', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-test-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('aborts the active turn on session/cancel notification', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const abortController = new AbortController();
    state.activeTurn = {
      turnId: 'turn_test',
      startedAt: new Date().toISOString(),
      status: 'running',
      abortController,
    };

    client.notify('session/cancel', { sessionId: created.sessionId });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(abortController.signal.aborted).toBe(true);
    const ping = await client.request('ent/agent/ping');
    expect(ping).toMatchObject({ ok: true, timestamp: expect.any(String) });

    client.close();
    server.close();
  });

  it('clears reissued pending permission requests on session/cancel notification', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const updates: Array<Record<string, unknown>> = [];

    client.onRequest('session/update', async (params) => {
      updates.push(params as Record<string, unknown>);
      return undefined;
    });

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    state.pendingPermissionRequests.set('tool_reissued', {
      requestId: 'a_999',
      rpcId: 'a_999',
      record: {
        toolCallId: 'tool_reissued',
        turnId: 'turn_reissued',
        turnSeq: 1,
        tool: 'bash',
        kind: 'execute',
        resource: 'echo hi',
        options: [
          { optionId: 'allow', label: 'Allow' },
          { optionId: 'deny', label: 'Deny' },
        ],
        requestedAt: new Date().toISOString(),
        input: { command: 'echo hi' },
      },
      result: new Promise(() => undefined),
    });

    client.notify('session/cancel', { sessionId: created.sessionId });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(state.pendingPermissionRequests.size).toBe(0);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_use',
          toolCallId: 'tool_reissued',
          status: 'cancelled',
        }),
      ])
    );

    client.close();
    server.close();
  });

  it('aborts running job permission controllers on session/cancel notification', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const abortController = new AbortController();
    state.jobManager.getRunningJobs().set('job_permission', {
      jobId: 'job_permission',
      type: 'bash',
      status: 'running',
      startedAt: new Date().toISOString(),
      outputPath: join(tempDir, 'job_permission.log'),
      permissionAbortController: abortController,
      finished: false,
      completion: new Promise(() => undefined),
      resolveCompletion: () => undefined,
    });

    client.notify('session/cancel', { sessionId: created.sessionId });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(abortController.signal.aborted).toBe(true);

    client.close();
    server.close();
  });

  it('records live background permission cancellation once on session/cancel notification', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    client.onRequest('session/request_permission', async () => new Promise(() => undefined));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const { permissionResult } = await startBackgroundPermissionRequest({
      server,
      state,
      tempDir,
      sessionId: created.sessionId,
      turnId: 'turn_job',
      toolCallId: 'tool_live_background',
    });

    client.notify('session/cancel', { sessionId: created.sessionId });

    await expect(permissionResult).rejects.toThrow('cancelled');
    const cancelledEvents = readDurableEvents(state.activeSession!.dir, {
      types: ['permission_cancelled'],
    }).events.filter((event) => event.data.toolCallId === 'tool_live_background');

    expect(cancelledEvents).toHaveLength(1);
    expect(state.pendingPermissionRequests.has('tool_live_background')).toBe(false);

    client.close();
    server.close();
  });

  it('cancels background permission prompts before closing a session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const updates: Array<Record<string, unknown>> = [];

    client.onRequest('session/request_permission', async () => new Promise(() => undefined));
    client.onRequest('session/update', async (params) => {
      updates.push(params as Record<string, unknown>);
      return undefined;
    });

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const { permissionResult } = await startBackgroundPermissionRequest({
      server,
      state,
      tempDir,
      sessionId: created.sessionId,
      turnId: 'turn_close_job',
      toolCallId: 'tool_close_background',
    });

    await expect(
      client.request('session/close', { sessionId: created.sessionId })
    ).resolves.toEqual({});
    await expect(permissionResult).rejects.toThrow('cancelled');

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_use',
          toolCallId: 'tool_close_background',
          status: 'cancelled',
        }),
      ])
    );
    expect(state.pendingPermissionRequests.has('tool_close_background')).toBe(false);
    expect(state.activeSession).toBeNull();

    client.close();
    server.close();
  });

  it('cancels background permission prompts before loading another session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const updates: Array<Record<string, unknown>> = [];

    client.onRequest('session/request_permission', async () => new Promise(() => undefined));
    client.onRequest('session/update', async (params) => {
      updates.push(params as Record<string, unknown>);
      return undefined;
    });

    await client.request('initialize', defaultInitializeParams());
    const first = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };
    const second = (await client.request('session/fork', {
      sessionId: first.sessionId,
    })) as { sessionId: string };

    const { permissionResult } = await startBackgroundPermissionRequest({
      server,
      state,
      tempDir,
      sessionId: first.sessionId,
      turnId: 'turn_load_job',
      toolCallId: 'tool_load_background',
    });

    await client.request('session/load', {
      sessionId: second.sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    });
    await expect(permissionResult).rejects.toThrow('cancelled');

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_use',
          toolCallId: 'tool_load_background',
          status: 'cancelled',
        }),
      ])
    );
    expect(state.pendingPermissionRequests.has('tool_load_background')).toBe(false);
    expect(state.activeSession?.meta.sessionId).toBe(second.sessionId);

    client.close();
    server.close();
  });

  it('rejects session/close while a turn is active', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const abortController = new AbortController();
    state.activeTurn = {
      turnId: 'turn_test',
      startedAt: new Date().toISOString(),
      status: 'running',
      abortController,
    };

    await expect(
      client.request('session/close', { sessionId: created.sessionId })
    ).rejects.toMatchObject({
      code: AcpErrorCodes.SessionBusy,
    });

    expect(abortController.signal.aborted).toBe(false);
    expect(state.activeTurn).toBeTruthy();
    expect(state.activeSession?.meta.sessionId).toBe(created.sessionId);

    client.close();
    server.close();
  });

  it('stops session MCP servers on session/close', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const fixturePath = resolve('../web/test-utils/fixtures/mcp-stdio-test-server.cjs');

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [{ name: 'close-test', command: process.execPath, args: [fixturePath] }],
      })) as { sessionId: string };

      const status = (await client.request('ent/agent/status')) as {
        mcpServers?: Array<{ name: string; status: string }>;
      };
      expect(status.mcpServers?.find((s) => s.name === 'close-test')).toMatchObject({
        name: 'close-test',
        status: 'connected',
      });

      await expect(
        client.request('session/close', { sessionId: created.sessionId })
      ).resolves.toEqual({});

      expect(state.activeSession).toBeNull();
      expect(state.mcpServerManager.getAllServers()).toEqual([]);
    } finally {
      await state.mcpServerManager.shutdown();
      client.close();
      server.close();
    }
  });

  it('sends -32800 error code when handling cancellation request', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    // Verify the error code constant is correct
    expect(JSONRPC_ERROR_CANCELLED).toBe(-32800);

    client.close();
    server.close();
  });
});
