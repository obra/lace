import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SessionPromptRequestSchema } from '@lace/ent-protocol';
import { agentMethodHandlers } from '../agent-method-handlers';
import { PendingPermissionsTracker } from '../pending-permissions-tracker';
import { Supervisor } from '../supervisor';
import type { SupervisorServerEvent } from './types';

type SupervisorServerOptions = {
  storeDir: string;
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

const CreateAgentSessionSchema = z.object({ persona: z.string().optional() }).strict();

const UpsertAgentMetaSchema = z
  .object({
    sessionId: z.string().min(1),
    name: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    toolPolicies: z.record(z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
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

type JsonRpcErrorLike = {
  code: number;
  message: string;
  data?: unknown;
};

function isJsonRpcErrorLike(value: unknown): value is JsonRpcErrorLike {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === 'number' && typeof v.message === 'string';
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

function endpointFileDefault(storeDir: string): string {
  return join(storeDir, 'supervisor', 'endpoint.json');
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

export function createSupervisorServer(options: SupervisorServerOptions): SupervisorServerHandle {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const endpointPath = options.endpointFilePath ?? endpointFileDefault(options.storeDir);

  const sseClients = new Set<ServerResponse>();
  const pendingPermissions = new PendingPermissionsTracker();

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
    storeDir: options.storeDir,
    onSessionUpdate: (workspaceSessionId, update) => {
      const projectId = supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;
      pendingPermissions.onSessionUpdate(workspaceSessionId, update);

      broadcast({
        type: 'session_update',
        workspaceSessionId,
        ...(projectId ? { projectId } : {}),
        update,
      });
    },
    onPermissionRequest: async (workspaceSessionId, params) => {
      const projectId = supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;
      const { toolCall, waitForDecision } = pendingPermissions.startPermissionRequest(
        workspaceSessionId,
        params
      );

      broadcast({
        type: 'permission_request',
        workspaceSessionId,
        ...(projectId ? { projectId } : {}),
        request: params,
        ...(toolCall ? { toolCall } : {}),
        requestedAt: new Date().toISOString(),
      });

      return await waitForDecision;
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

        // Send heartbeat every 30s to prevent client body timeout
        const heartbeat = setInterval(() => {
          try {
            res.write(': heartbeat\n\n');
          } catch {
            clearInterval(heartbeat);
          }
        }, 30_000);

        req.on('close', () => {
          clearInterval(heartbeat);
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
          const body = CreateAgentSessionSchema.parse(await readJson(req));
          const created = await supervisor.createAgentSession(workspaceSessionId, {
            ...(body.persona ? { persona: body.persona } : {}),
          });
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
          const peer = await supervisor.getPeer(workspaceSessionId, body.sessionId);
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
          const peer = await supervisor.getPeer(workspaceSessionId, body.sessionId);
          peer.notify(body.method, parsedParams);
          return asJson(res, 200, { ok: true });
        }

        if (method === 'GET' && rest === 'pending-permissions') {
          return asJson(res, 200, pendingPermissions.listPendingPermissions(workspaceSessionId));
        }

        if (
          method === 'POST' &&
          restParts[0] === 'pending-permissions' &&
          restParts[1] &&
          restParts.length === 2
        ) {
          const toolCallId = decodeURIComponent(restParts[1]);
          const body = ResolvePermissionSchema.parse(await readJson(req));

          const resolved = pendingPermissions.resolvePendingPermission({
            workspaceSessionId,
            toolCallId,
            decision: body.decision,
            ...(body.updatedInput ? { updatedInput: body.updatedInput } : {}),
          });

          if (!resolved.ok) {
            if (resolved.error === 'ambiguous') {
              return asJson(res, 409, { ok: false, error: 'Tool call is ambiguous' });
            }
            return asJson(res, 404, { ok: false });
          }

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

      // Preserve JSON-RPC error objects (from peer.request rejections)
      // These have structured fields { code, message, data? } but are not Error instances.
      if (isJsonRpcErrorLike(error)) {
        return asJson(res, 500, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.data !== undefined ? { data: error.data } : {}),
          },
        });
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
      pendingPermissions.shutdown();
      await supervisor.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
