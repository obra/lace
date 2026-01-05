// ABOUTME: Web-facing supervisor client singleton
// ABOUTME: Spawns (if needed) a supervisor server process and bridges its updates into EventStreamManager SSE broadcasts

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SupervisorClient,
  type PendingPermission,
  type SupervisorServerEvent,
  type SupervisorSessionUpdate,
} from '@lace/supervisor';
import { ensureLaceDir } from '@lace/web/lib/server/lace-imports';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import type { LaceEvent } from '@lace/web/types/core';

declare global {
  var laceWebSupervisorClient: SupervisorClient | undefined;
  var laceWebSupervisorProc: ChildProcessWithoutNullStreams | undefined;
  var laceWebSupervisorEventBridge: Promise<void> | undefined;
  var laceWebSupervisorEventBridgeAbort: AbortController | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type ToolResultContentItem =
  | { type: 'text'; text: string }
  | { type: 'json'; data: unknown }
  | { type: 'image'; data: string; mediaType?: string }
  | { type: 'error'; message: string; code?: string };

function isToolResultContentItem(value: unknown): value is ToolResultContentItem {
  if (!isRecord(value)) return false;

  if (value.type === 'text') return typeof value.text === 'string';
  if (value.type === 'json') return 'data' in value && value.data !== undefined;
  if (value.type === 'image') return typeof value.data === 'string';
  if (value.type === 'error') return typeof value.message === 'string';

  return false;
}

function toToolResultContent(
  content: ToolResultContentItem[]
): Array<{ type: 'text'; text: string }> {
  return content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'json') return { type: 'text', text: JSON.stringify(c.data, null, 2) };
    if (c.type === 'image') return { type: 'text', text: `[image:${c.mediaType ?? 'unknown'}]` };
    return { type: 'text', text: c.message };
  });
}

function updateToLaceEvents(params: {
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId?: string;
  update: SupervisorSessionUpdate;
}): LaceEvent[] {
  const { workspaceSessionId, projectId, agentSessionId, update } = params;
  const type = update.type;

  const baseContext: LaceEvent['context'] = {
    sessionId: workspaceSessionId,
    ...(projectId ? { projectId } : {}),
    ...(agentSessionId ? { threadId: agentSessionId } : {}),
  };

  if (type === 'text_delta' && typeof update.text === 'string') {
    return [
      {
        type: 'AGENT_STREAMING',
        timestamp: new Date(),
        transient: true,
        data: { content: update.text },
        context: baseContext,
      },
    ];
  }

  if (type === 'tool_use') {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    const name = typeof update.name === 'string' ? update.name : '';
    const input = isRecord(update.input) ? update.input : {};
    const status = typeof update.status === 'string' ? update.status : '';

    const events: LaceEvent[] = [];

    if (status === 'pending' || status === 'awaiting_permission') {
      if (toolCallId && name && agentSessionId) {
        const key = permissionKey(agentSessionId, toolCallId);
        global.laceWebPendingToolCalls?.set(key, {
          workspaceSessionId,
          agentSessionId,
          toolCallId,
          toolCall: { name, arguments: input },
          createdAt: Date.now(),
        });
      }

      events.push({
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: toolCallId, name, arguments: input },
        context: baseContext,
      });
    }

    if (
      (status === 'completed' ||
        status === 'failed' ||
        status === 'denied' ||
        status === 'timeout' ||
        status === 'cancelled') &&
      update.result &&
      isRecord(update.result)
    ) {
      const result = update.result;
      const rawContent: unknown[] = Array.isArray(result.content) ? result.content : [];
      const content = rawContent.filter(isToolResultContentItem);

      events.push({
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          id: toolCallId,
          status: status === 'completed' ? 'completed' : status === 'denied' ? 'denied' : 'failed',
          content: toToolResultContent(content),
        },
        context: baseContext,
      });
    }

    return events;
  }

  return [];
}

type SupervisorEndpoint = {
  baseUrl: string;
  host: string;
  port: number;
  pid: number;
  startedAt: string;
};

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

function resolveSupervisorMainPath(): string {
  const mainUrl = new URL('../../../supervisor/dist/main.js', import.meta.url);
  const mainPath = fileURLToPath(mainUrl);
  if (!existsSync(mainPath)) {
    throw new Error(
      'Could not resolve lace supervisor entrypoint (packages/supervisor/dist/main.js)'
    );
  }
  return mainPath;
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
    global.laceWebSupervisorProc = spawn(
      process.execPath,
      [mainPath, '--host', '127.0.0.1', '--port', '0'],
      {
        env: { ...process.env, LACE_DIR: laceDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    global.laceWebSupervisorProc.stderr.on('data', (d) => {
      const text = String(d);
      if (text.trim()) console.error(text.trim());
    });
  }

  return await waitForSupervisorReady({ laceDir, timeoutMs: 10_000 });
}

function bridgeEventToWeb(event: SupervisorServerEvent, params: { supervisorProjectId?: string }) {
  if (event.type === 'session_update') {
    const events = updateToLaceEvents({
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
      agentSessionId: event.update.sessionId,
      update: event.update,
    });

    if (events.length === 0) return;
    const manager = EventStreamManager.getInstance();
    for (const e of events) manager.broadcast(e);
    return;
  }

  if (event.type === 'permission_request') {
    const manager = EventStreamManager.getInstance();
    manager.broadcast({
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date(event.requestedAt),
      data: { toolCallId: event.request.toolCallId },
      context: {
        sessionId: event.workspaceSessionId,
        ...(params.supervisorProjectId ? { projectId: params.supervisorProjectId } : {}),
        ...(event.request.sessionId ? { threadId: event.request.sessionId } : {}),
      },
    });
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
