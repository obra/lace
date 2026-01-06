// ABOUTME: Web-facing supervisor client singleton
// ABOUTME: Spawns (if needed) a supervisor server process and bridges its updates into EventStreamManager SSE broadcasts

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  SupervisorClient,
  type PendingPermission,
  type SupervisorServerEvent,
  type SupervisorSessionUpdate,
} from '@lace/supervisor';
import { ensureLaceDir } from '@lace/web/lib/server/lace-imports';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import type {
  ProtocolEvent,
  PermissionRequestEvent,
  SessionUpdate,
} from '@lace/web/types/protocol-events';

declare global {
  var laceWebSupervisorClient: SupervisorClient | undefined;
  var laceWebSupervisorProc: ChildProcess | undefined;
  var laceWebSupervisorEventBridge: Promise<void> | undefined;
  var laceWebSupervisorEventBridgeAbort: AbortController | undefined;
}

/**
 * Create a ProtocolEvent wrapper from a supervisor session update.
 * This preserves the raw protocol update data without translation.
 */
function createProtocolEvent(params: {
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId: string;
  update: SupervisorSessionUpdate;
}): ProtocolEvent {
  const { workspaceSessionId, projectId, agentSessionId, update } = params;

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    update: update as SessionUpdate, // SupervisorSessionUpdate matches SessionUpdate shape
    workspaceSessionId,
    projectId,
    agentSessionId,
  };
}

/**
 * Create a PermissionRequestEvent wrapper from a supervisor permission request.
 */
function createPermissionRequestEvent(params: {
  workspaceSessionId: string;
  projectId?: string;
  request: SupervisorServerEvent & { type: 'permission_request' };
}): PermissionRequestEvent {
  const { workspaceSessionId, projectId, request } = params;

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    request: request.request,
    workspaceSessionId,
    projectId,
  };
}

type SupervisorEndpoint = {
  baseUrl: string;
  host: string;
  port: number;
  pid: number;
  startedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpointFilePath(laceDir: string): string {
  return `${laceDir}/supervisor/endpoint.json`;
}

function readSupervisorEndpoint(laceDir: string): SupervisorEndpoint | null {
  const path = endpointFilePath(laceDir);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.baseUrl !== 'string') return null;
    if (typeof parsed.host !== 'string') return null;
    if (typeof parsed.port !== 'number') return null;
    if (typeof parsed.pid !== 'number') return null;
    if (typeof parsed.startedAt !== 'string') return null;
    return parsed as SupervisorEndpoint;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const require = createRequire(import.meta.url);

function resolveSupervisorMainPath(): string {
  try {
    return require.resolve('@lace/supervisor/dist/main.js');
  } catch {
    throw new Error('Could not resolve lace supervisor entrypoint (@lace/supervisor/dist/main.js)');
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSupervisorReady(params: {
  laceDir: string;
  timeoutMs: number;
}): Promise<SupervisorEndpoint> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const endpoint = readSupervisorEndpoint(params.laceDir);
    if (!endpoint) {
      await sleep(50);
      continue;
    }

    const client = new SupervisorClient({ baseUrl: endpoint.baseUrl });
    try {
      await client.health();
      return endpoint;
    } catch {
      await sleep(50);
    }
  }
  throw new Error('Timed out waiting for supervisor server');
}

async function ensureSupervisorServer(laceDir: string): Promise<SupervisorEndpoint> {
  const existing = readSupervisorEndpoint(laceDir);
  if (existing && isProcessAlive(existing.pid)) {
    const client = new SupervisorClient({ baseUrl: existing.baseUrl });
    try {
      await client.health();
      return existing;
    } catch {
      // fall through
    }
  }

  if (global.laceWebSupervisorProc && global.laceWebSupervisorProc.exitCode !== null) {
    global.laceWebSupervisorProc = undefined;
  }

  if (!global.laceWebSupervisorProc) {
    const mainPath = resolveSupervisorMainPath();
    const proc = spawn(process.execPath, [mainPath, '--host', '127.0.0.1', '--port', '0'], {
      env: { ...process.env, LACE_DIR: laceDir },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    global.laceWebSupervisorProc = proc;

    proc.stderr?.on('data', (d) => {
      const text = String(d);
      if (text.trim()) console.error(text.trim());
    });
  }

  return await waitForSupervisorReady({ laceDir, timeoutMs: 10_000 });
}

function bridgeEventToWeb(event: SupervisorServerEvent, params: { supervisorProjectId?: string }) {
  const manager = EventStreamManager.getInstance();

  if (event.type === 'session_update') {
    const protocolEvent = createProtocolEvent({
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
      agentSessionId: event.update.sessionId,
      update: event.update,
    });
    manager.broadcast(protocolEvent);
    return;
  }

  if (event.type === 'permission_request') {
    const permissionEvent = createPermissionRequestEvent({
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
      request: event,
    });
    manager.broadcast(permissionEvent);
  }
}

async function startEventBridge(client: SupervisorClient): Promise<void> {
  if (global.laceWebSupervisorEventBridge) return;

  const abort = new AbortController();
  global.laceWebSupervisorEventBridgeAbort = abort;
  global.laceWebSupervisorEventBridge = (async () => {
    while (!abort.signal.aborted) {
      try {
        await client.subscribeEvents({
          signal: abort.signal,
          onEvent: async (event) => {
            bridgeEventToWeb(event, { supervisorProjectId: event.projectId });
          },
        });
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error('Supervisor event bridge error:', err);
        await sleep(200);
      }
    }
  })();
}

export async function getSupervisor(): Promise<SupervisorClient> {
  if (global.laceWebSupervisorClient) return global.laceWebSupervisorClient;

  const laceDir = ensureLaceDir();
  const endpoint = await ensureSupervisorServer(laceDir);
  global.laceWebSupervisorClient = new SupervisorClient({ baseUrl: endpoint.baseUrl });

  await startEventBridge(global.laceWebSupervisorClient);
  return global.laceWebSupervisorClient;
}

export async function listPendingPermissions(
  workspaceSessionId: string
): Promise<PendingPermission[]> {
  const supervisor = await getSupervisor();
  return await supervisor.listPendingPermissions(workspaceSessionId);
}

export async function resolvePendingPermission(params: {
  workspaceSessionId: string;
  toolCallId: string;
  decision: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
}): Promise<boolean> {
  const supervisor = await getSupervisor();
  return await supervisor.resolvePendingPermission(params);
}

export async function shutdownSupervisorForTests(): Promise<void> {
  global.laceWebSupervisorEventBridgeAbort?.abort();
  global.laceWebSupervisorEventBridgeAbort = undefined;
  global.laceWebSupervisorEventBridge = undefined;

  const client = global.laceWebSupervisorClient;
  global.laceWebSupervisorClient = undefined;

  const proc = global.laceWebSupervisorProc;
  global.laceWebSupervisorProc = undefined;

  if (client) {
    try {
      await client.shutdown();
    } catch {
      // ignore
    }
  }

  if (proc && proc.exitCode === null) {
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  }
}
