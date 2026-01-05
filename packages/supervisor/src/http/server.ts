import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  EntAgentStatusRequestSchema,
  EntAgentStatusResponseSchema,
  EntConnectionsCredentialsClearRequestSchema,
  EntConnectionsCredentialsClearResponseSchema,
  EntConnectionsCredentialsStartRequestSchema,
  EntConnectionsCredentialsStartResponseSchema,
  EntConnectionsCredentialsStatusRequestSchema,
  EntConnectionsCredentialsStatusResponseSchema,
  EntConnectionsCredentialsSubmitRequestSchema,
  EntConnectionsCredentialsSubmitResponseSchema,
  EntConnectionsDeleteRequestSchema,
  EntConnectionsDeleteResponseSchema,
  EntConnectionsListRequestSchema,
  EntConnectionsListResponseSchema,
  EntConnectionsUpsertRequestSchema,
  EntConnectionsUpsertResponseSchema,
  EntJobKillRequestSchema,
  EntJobKillResponseSchema,
  EntJobListRequestSchema,
  EntJobListResponseSchema,
  EntJobOutputRequestSchema,
  EntJobOutputResponseSchema,
  EntModelsListRequestSchema,
  EntModelsListResponseSchema,
  EntProvidersListRequestSchema,
  EntProvidersListResponseSchema,
  EntSessionConfigureRequestSchema,
  EntSessionConfigureResponseSchema,
  EntSessionEventsRequestSchema,
  EntSessionEventsResponseSchema,
  EntSessionInjectNotificationSchema,
  SessionCancelNotificationSchema,
  SessionPromptRequestSchema,
  SessionPromptResponseSchema,
} from '@lace/ent-protocol';
import { Supervisor } from '../supervisor';
import type {
  PendingPermission,
  SupervisorPermissionRequest,
  SupervisorServerEvent,
} from './types';

type SupervisorServerOptions = {
  laceDir: string;
  host?: string;
  port?: number;
  endpointFilePath?: string;
};

type SupervisorServerHandle = {
  listen: () => Promise<{ baseUrl: string; host: string; port: number }>;
  close: () => Promise<void>;
};

const WorkspaceSessionCreateSchema = z
  .object({
    workDir: z.string().min(1),
  })
  .strict();

const WorkspaceSessionAttachSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

const WorkspaceSessionUpdateSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .strict();

const CreateAgentSessionSchema = z.object({}).strict();

const UpsertAgentMetaSchema = z
  .object({
    sessionId: z.string().min(1),
    name: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
  })
  .strict();

const PromptSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    content: SessionPromptRequestSchema.shape.params.shape.content,
  })
  .strict();

const AgentRequestSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

const AgentNotifySchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

const ResolvePermissionSchema = z
  .object({
    decision: z.enum(['allow', 'deny']),
    updatedInput: z.record(z.unknown()).optional(),
  })
  .strict();

type AgentMethodHandler =
  | {
      kind: 'request';
      paramsSchema: z.ZodTypeAny;
      resultSchema: z.ZodTypeAny;
    }
  | { kind: 'notify'; paramsSchema: z.ZodTypeAny };

const agentMethodHandlers: Record<string, AgentMethodHandler> = {
  'session/prompt': {
    kind: 'request',
    paramsSchema: SessionPromptRequestSchema.shape.params,
    resultSchema: SessionPromptResponseSchema.shape.result,
  },
  'session/cancel': {
    kind: 'notify',
    paramsSchema: SessionCancelNotificationSchema.shape.params.optional(),
  },
  'ent/session/configure': {
    kind: 'request',
    paramsSchema: EntSessionConfigureRequestSchema.shape.params,
    resultSchema: EntSessionConfigureResponseSchema.shape.result,
  },
  'ent/session/inject': {
    kind: 'notify',
    paramsSchema: EntSessionInjectNotificationSchema.shape.params,
  },
  'ent/agent/status': {
    kind: 'request',
    paramsSchema: EntAgentStatusRequestSchema.shape.params.optional(),
    resultSchema: EntAgentStatusResponseSchema.shape.result,
  },
  'ent/session/events': {
    kind: 'request',
    paramsSchema: EntSessionEventsRequestSchema.shape.params.optional(),
    resultSchema: EntSessionEventsResponseSchema.shape.result,
  },
  'ent/providers/list': {
    kind: 'request',
    paramsSchema: EntProvidersListRequestSchema.shape.params,
    resultSchema: EntProvidersListResponseSchema.shape.result,
  },
  'ent/connections/list': {
    kind: 'request',
    paramsSchema: EntConnectionsListRequestSchema.shape.params,
    resultSchema: EntConnectionsListResponseSchema.shape.result,
  },
  'ent/connections/upsert': {
    kind: 'request',
    paramsSchema: EntConnectionsUpsertRequestSchema.shape.params,
    resultSchema: EntConnectionsUpsertResponseSchema.shape.result,
  },
  'ent/connections/delete': {
    kind: 'request',
    paramsSchema: EntConnectionsDeleteRequestSchema.shape.params,
    resultSchema: EntConnectionsDeleteResponseSchema.shape.result,
  },
  'ent/connections/credentials/status': {
    kind: 'request',
    paramsSchema: EntConnectionsCredentialsStatusRequestSchema.shape.params,
    resultSchema: EntConnectionsCredentialsStatusResponseSchema.shape.result,
  },
  'ent/connections/credentials/start': {
    kind: 'request',
    paramsSchema: EntConnectionsCredentialsStartRequestSchema.shape.params,
    resultSchema: EntConnectionsCredentialsStartResponseSchema.shape.result,
  },
  'ent/connections/credentials/submit': {
    kind: 'request',
    paramsSchema: EntConnectionsCredentialsSubmitRequestSchema.shape.params,
    resultSchema: EntConnectionsCredentialsSubmitResponseSchema.shape.result,
  },
  'ent/connections/credentials/clear': {
    kind: 'request',
    paramsSchema: EntConnectionsCredentialsClearRequestSchema.shape.params,
    resultSchema: EntConnectionsCredentialsClearResponseSchema.shape.result,
  },
  'ent/models/list': {
    kind: 'request',
    paramsSchema: EntModelsListRequestSchema.shape.params,
    resultSchema: EntModelsListResponseSchema.shape.result,
  },
  'ent/job/list': {
    kind: 'request',
    paramsSchema: EntJobListRequestSchema.shape.params,
    resultSchema: EntJobListResponseSchema.shape.result,
  },
  'ent/job/output': {
    kind: 'request',
    paramsSchema: EntJobOutputRequestSchema.shape.params,
    resultSchema: EntJobOutputResponseSchema.shape.result,
  },
  'ent/job/kill': {
    kind: 'request',
    paramsSchema: EntJobKillRequestSchema.shape.params,
    resultSchema: EntJobKillResponseSchema.shape.result,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

function notFound(res: ServerResponse) {
  asJson(res, 404, { error: 'Not found' });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function endpointFileDefault(laceDir: string): string {
  return join(laceDir, 'supervisor', 'endpoint.json');
}

function writeEndpointFile(params: {
  filePath: string;
  baseUrl: string;
  host: string;
  port: number;
}) {
  mkdirSync(dirname(params.filePath), { recursive: true });
  writeFileSync(
    params.filePath,
    JSON.stringify(
      {
        baseUrl: params.baseUrl,
        host: params.host,
        port: params.port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
}

function permissionKey(agentSessionId: string, toolCallId: string): string {
  return `${agentSessionId}:${toolCallId}`;
}

export function createSupervisorServer(options: SupervisorServerOptions): SupervisorServerHandle {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const endpointPath = options.endpointFilePath ?? endpointFileDefault(options.laceDir);

  const sseClients = new Set<ServerResponse>();
  const pendingToolCalls = new Map<
    string,
    {
      workspaceSessionId: string;
      agentSessionId: string;
      toolCallId: string;
      toolCall: { name: string; arguments: Record<string, unknown> };
      createdAt: number;
    }
  >();
  const pendingPermissions = new Map<
    string,
    {
      workspaceSessionId: string;
      agentSessionId: string;
      toolCallId: string;
      toolCall?: { name: string; arguments: Record<string, unknown> };
      request: SupervisorPermissionRequest;
      requestedAt: number;
      resolve: (decision: {
        decision: 'allow' | 'deny';
        updatedInput?: Record<string, unknown>;
      }) => void;
    }
  >();

  function broadcast(event: SupervisorServerEvent) {
    for (const client of sseClients) {
      try {
        writeSse(client, event.type, event);
      } catch {
        // ignore
      }
    }
  }

  const supervisor = new Supervisor({
    laceDir: options.laceDir,
    onSessionUpdate: (workspaceSessionId, update) => {
      const projectId = supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;
      if (update.type === 'tool_use') {
        const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
        const name = typeof update.name === 'string' ? update.name : '';
        const input = isRecord(update.input) ? update.input : {};
        const status = typeof update.status === 'string' ? update.status : '';

        if (
          toolCallId &&
          name &&
          update.sessionId &&
          (status === 'pending' || status === 'awaiting_permission')
        ) {
          const key = permissionKey(update.sessionId, toolCallId);
          pendingToolCalls.set(key, {
            workspaceSessionId,
            agentSessionId: update.sessionId,
            toolCallId,
            toolCall: { name, arguments: input },
            createdAt: Date.now(),
          });
        }
      }

      broadcast({
        type: 'session_update',
        workspaceSessionId,
        ...(projectId ? { projectId } : {}),
        update,
      });
    },
    onPermissionRequest: async (workspaceSessionId, params) => {
      const timeoutMs = 5 * 60 * 1000;
      const projectId = supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;

      const agentSessionId = params.sessionId;
      const toolCallId = params.toolCallId;
      const key = permissionKey(agentSessionId, toolCallId);

      const toolCallFromUpdates = pendingToolCalls.get(key);
      const toolCall =
        toolCallFromUpdates &&
        toolCallFromUpdates.workspaceSessionId === workspaceSessionId &&
        toolCallFromUpdates.agentSessionId === agentSessionId
          ? toolCallFromUpdates.toolCall
          : undefined;

      pendingToolCalls.delete(key);

      broadcast({
        type: 'permission_request',
        workspaceSessionId,
        ...(projectId ? { projectId } : {}),
        request: params,
        ...(toolCall ? { toolCall } : {}),
        requestedAt: new Date().toISOString(),
      });

      return await new Promise<{
        decision: 'allow' | 'deny';
        updatedInput?: Record<string, unknown>;
      }>((resolve) => {
        pendingPermissions.set(key, {
          workspaceSessionId,
          agentSessionId,
          toolCallId,
          ...(toolCall ? { toolCall } : {}),
          request: params,
          requestedAt: Date.now(),
          resolve,
        });

        setTimeout(() => {
          const still = pendingPermissions.get(key);
          if (!still) return;
          pendingPermissions.delete(key);
          pendingToolCalls.delete(key);
          still.resolve({ decision: 'deny' });
        }, timeoutMs);
      });
    },
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && pathname === '/health') {
        return asJson(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/events') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write('\n');

        sseClients.add(res);
        req.on('close', () => {
          sseClients.delete(res);
        });
        return;
      }

      if (method === 'POST' && pathname === '/shutdown') {
        asJson(res, 200, { ok: true });
        void (async () => {
          await supervisor.shutdown();
          server.close(() => process.exit(0));
        })();
        return;
      }

      if (method === 'GET' && pathname === '/workspace-sessions') {
        return asJson(res, 200, supervisor.listWorkspaceSessions());
      }

      if (method === 'POST' && pathname === '/workspace-sessions') {
        const body = WorkspaceSessionCreateSchema.parse(await readJson(req));
        const created = await supervisor.createWorkspaceSession(body.workDir);
        return asJson(res, 201, created);
      }

      if (method === 'POST' && pathname === '/workspace-sessions/attach') {
        const body = WorkspaceSessionAttachSchema.parse(await readJson(req));
        const attached = await supervisor.attachWorkspaceSession(body.sessionId);
        return asJson(res, 201, attached);
      }

      const parts = pathname.split('/').filter(Boolean);
      if (parts[0] === 'workspace-sessions' && parts[1]) {
        const workspaceSessionId = decodeURIComponent(parts[1]);
        const restParts = parts.slice(2);
        const rest = restParts.join('/');

        if (method === 'GET' && rest === '') {
          const record = supervisor.getWorkspaceSession(workspaceSessionId);
          if (!record) return asJson(res, 404, { error: 'Session not found' });
          return asJson(res, 200, record);
        }

        if (method === 'PATCH' && rest === '') {
          const body = WorkspaceSessionUpdateSchema.parse(await readJson(req));
          supervisor.updateWorkspaceSession(workspaceSessionId, body);
          const record = supervisor.getWorkspaceSession(workspaceSessionId);
          if (!record) return asJson(res, 404, { error: 'Session not found' });
          return asJson(res, 200, record);
        }

        if (method === 'DELETE' && rest === '') {
          const ok = await supervisor.deleteWorkspaceSession(workspaceSessionId);
          return asJson(res, 200, { ok });
        }

        if (method === 'POST' && rest === 'agent-sessions') {
          CreateAgentSessionSchema.parse(await readJson(req));
          const created = await supervisor.createAgentSession(workspaceSessionId);
          return asJson(res, 201, created);
        }

        if (method === 'POST' && rest === 'agents/meta') {
          const body = UpsertAgentMetaSchema.parse(await readJson(req));
          supervisor.upsertAgentSessionMeta(workspaceSessionId, body);
          return asJson(res, 200, { ok: true });
        }

        if (method === 'POST' && rest === 'prompt') {
          const body = PromptSchema.parse(await readJson(req));
          const result = body.sessionId
            ? await supervisor.promptSession(workspaceSessionId, body.sessionId, body.content)
            : await supervisor.prompt(workspaceSessionId, body.content);
          return asJson(res, 200, result);
        }

        if (method === 'POST' && rest === 'agent/request') {
          const body = AgentRequestSchema.parse(await readJson(req));
          const handler = agentMethodHandlers[body.method];
          if (!handler || handler.kind !== 'request') {
            return asJson(res, 400, { error: `Unsupported request method: ${body.method}` });
          }

          const parsedParams = handler.paramsSchema.parse(body.params ?? {});
          const peer = supervisor.getPeer(workspaceSessionId, body.sessionId);
          const result = await peer.request(body.method, parsedParams);
          return asJson(res, 200, { result: handler.resultSchema.parse(result) });
        }

        if (method === 'POST' && rest === 'agent/notify') {
          const body = AgentNotifySchema.parse(await readJson(req));
          const handler = agentMethodHandlers[body.method];
          if (!handler || handler.kind !== 'notify') {
            return asJson(res, 400, { error: `Unsupported notify method: ${body.method}` });
          }

          const parsedParams = handler.paramsSchema.parse(body.params ?? {});
          const peer = supervisor.getPeer(workspaceSessionId, body.sessionId);
          peer.notify(body.method, parsedParams);
          return asJson(res, 200, { ok: true });
        }

        if (method === 'GET' && rest === 'pending-permissions') {
          const out: PendingPermission[] = Array.from(pendingPermissions.values())
            .filter((p) => p.workspaceSessionId === workspaceSessionId)
            .map((p) => ({
              workspaceSessionId: p.workspaceSessionId,
              agentSessionId: p.agentSessionId,
              toolCallId: p.toolCallId,
              ...(p.toolCall ? { toolCall: p.toolCall } : {}),
              request: p.request,
              requestedAt: new Date(p.requestedAt).toISOString(),
            }));

          out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
          return asJson(res, 200, out);
        }

        if (
          method === 'POST' &&
          restParts[0] === 'pending-permissions' &&
          restParts[1] &&
          restParts.length === 2
        ) {
          const toolCallId = decodeURIComponent(restParts[1]);
          const body = ResolvePermissionSchema.parse(await readJson(req));

          const candidates = Array.from(pendingPermissions.values()).filter(
            (p) => p.workspaceSessionId === workspaceSessionId && p.toolCallId === toolCallId
          );

          if (candidates.length === 0) return asJson(res, 404, { ok: false });
          if (candidates.length > 1)
            return asJson(res, 409, { ok: false, error: 'Tool call is ambiguous' });

          const found = candidates[0]!;
          const key = permissionKey(found.agentSessionId, found.toolCallId);
          pendingPermissions.delete(key);
          pendingToolCalls.delete(key);

          found.resolve({
            decision: body.decision,
            ...(body.updatedInput ? { updatedInput: body.updatedInput } : {}),
          });

          return asJson(res, 200, { ok: true });
        }
      }

      return notFound(res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return asJson(res, 400, { error: 'Validation failed', details: error.errors });
      }

      if (error instanceof SyntaxError) {
        return asJson(res, 400, { error: 'Invalid JSON' });
      }

      const message = error instanceof Error ? error.message : 'Internal error';
      return asJson(res, 500, { error: message });
    }
  });

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', (err) => reject(err));
        server.listen(port, host, () => {
          const address = server.address();
          if (!address || typeof address !== 'object') {
            reject(new Error('Could not determine supervisor server port'));
            return;
          }
          const actualPort = address.port;
          const baseUrl = `http://${host}:${actualPort}`;
          writeEndpointFile({ filePath: endpointPath, baseUrl, host, port: actualPort });
          resolve({ baseUrl, host, port: actualPort });
        });
      }),
    close: async () => {
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      await supervisor.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
