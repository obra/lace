import type {
  AgentSessionHandle,
  CreateAgentSessionOptions,
  WorkspaceSessionHandle,
} from '../supervisor';
import type { WorkspaceSessionRecord } from '../workspace-session-store';
import type { PendingPermission, SupervisorServerEvent } from './types';
import type { ToolPolicy } from '@lace/ent-protocol';

type SupervisorClientOptions = {
  baseUrl: string;
};

export class SupervisorHttpError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly data?: unknown;
  readonly raw?: unknown;

  constructor(params: { status: number; message: string; code?: number; data?: unknown; raw?: unknown }) {
    super(params.message);
    this.name = 'SupervisorHttpError';
    this.status = params.status;
    this.code = params.code;
    this.data = params.data;
    this.raw = params.raw;
  }
}

function asUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

type JsonRpcErrorLike = { code: number; message: string; data?: unknown };

function isJsonRpcErrorLike(value: unknown): value is JsonRpcErrorLike {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === 'number' && typeof v.message === 'string';
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const errorValue =
      parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? (parsed as { error?: unknown }).error
        : undefined;

    // Preserve existing behavior for string errors.
    if (typeof errorValue === 'string') {
      throw new Error(errorValue);
    }

    // Preserve structured JSON-RPC errors across the HTTP client boundary.
    if (isJsonRpcErrorLike(errorValue)) {
      throw new SupervisorHttpError({
        status: res.status,
        code: errorValue.code,
        message: errorValue.message,
        data: errorValue.data,
        raw: parsed,
      });
    }

    // Preserve existing behavior for other object-shaped errors.
    if (errorValue && typeof errorValue === 'object') {
      const errObj = errorValue as { message?: unknown; code?: unknown };
      const msg = typeof errObj.message === 'string' ? errObj.message : `HTTP ${res.status}`;
      const code = typeof errObj.code === 'number' ? errObj.code : undefined;
      const full = code !== undefined ? `${msg} (code ${code})` : msg;
      throw new Error(full);
    }

    throw new Error(`HTTP ${res.status}`);
  }
  return parsed as T;
}

export class SupervisorClient {
  private readonly baseUrl: string;

  constructor(options: SupervisorClientOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
  }

  async health(): Promise<{ ok: true }> {
    return await fetchJson(asUrl(this.baseUrl, '/health'));
  }

  async shutdown(): Promise<void> {
    await fetchJson(asUrl(this.baseUrl, '/shutdown'), { method: 'POST' });
  }

  async listWorkspaceSessions(): Promise<WorkspaceSessionRecord[]> {
    return await fetchJson(asUrl(this.baseUrl, '/workspace-sessions'));
  }

  async getWorkspaceSession(
    workspaceSessionId: string
  ): Promise<WorkspaceSessionRecord | undefined> {
    try {
      return await fetchJson(
        asUrl(this.baseUrl, `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}`)
      );
    } catch (error) {
      if (error instanceof SupervisorHttpError && error.status === 404) return undefined;
      if (error instanceof Error && error.message.includes('Session not found')) return undefined;
      if (error instanceof Error && error.message.includes('HTTP 404')) return undefined;
      throw error;
    }
  }

  async createWorkspaceSession(workDir: string): Promise<WorkspaceSessionHandle> {
    return await fetchJson(asUrl(this.baseUrl, '/workspace-sessions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workDir }),
    });
  }

  async attachWorkspaceSession(sessionId: string): Promise<WorkspaceSessionHandle> {
    return await fetchJson(asUrl(this.baseUrl, '/workspace-sessions/attach'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  }

  async updateWorkspaceSession(
    workspaceSessionId: string,
    updates: { projectId?: string; name?: string }
  ): Promise<WorkspaceSessionRecord> {
    return await fetchJson(
      asUrl(this.baseUrl, `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}`),
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }
    );
  }

  async deleteWorkspaceSession(workspaceSessionId: string): Promise<{ ok: boolean }> {
    return await fetchJson(
      asUrl(this.baseUrl, `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}`),
      {
        method: 'DELETE',
      }
    );
  }

  async createAgentSession(
    workspaceSessionId: string,
    options?: CreateAgentSessionOptions
  ): Promise<AgentSessionHandle> {
    return await fetchJson(
      asUrl(
        this.baseUrl,
        `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/agent-sessions`
      ),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(options?.persona ? { persona: options.persona } : {}),
        }),
      }
    );
  }

  async upsertAgentSessionMeta(
    workspaceSessionId: string,
    params: {
      sessionId: string;
      name?: string;
      connectionId?: string;
      modelId?: string;
      toolPolicies?: Record<string, ToolPolicy>;
    }
  ): Promise<void> {
    await fetchJson(
      asUrl(
        this.baseUrl,
        `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/agents/meta`
      ),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      }
    );
  }

  async prompt(workspaceSessionId: string, content: unknown): Promise<unknown> {
    return await fetchJson(
      asUrl(this.baseUrl, `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/prompt`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );
  }

  async promptSession(
    workspaceSessionId: string,
    sessionId: string,
    content: unknown
  ): Promise<unknown> {
    return await fetchJson(
      asUrl(this.baseUrl, `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/prompt`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, content }),
      }
    );
  }

  async agentRequest(params: {
    workspaceSessionId: string;
    sessionId?: string;
    method: string;
    requestParams?: unknown;
  }): Promise<unknown> {
    const out = await fetchJson<{ result: unknown }>(
      asUrl(
        this.baseUrl,
        `/workspace-sessions/${encodeURIComponent(params.workspaceSessionId)}/agent/request`
      ),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: params.sessionId,
          method: params.method,
          params: params.requestParams,
        }),
      }
    );
    return out.result;
  }

  async agentNotify(params: {
    workspaceSessionId: string;
    sessionId?: string;
    method: string;
    notifyParams?: unknown;
  }): Promise<void> {
    await fetchJson(
      asUrl(
        this.baseUrl,
        `/workspace-sessions/${encodeURIComponent(params.workspaceSessionId)}/agent/notify`
      ),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: params.sessionId,
          method: params.method,
          params: params.notifyParams,
        }),
      }
    );
  }

  async listPendingPermissions(workspaceSessionId: string): Promise<PendingPermission[]> {
    return await fetchJson(
      asUrl(
        this.baseUrl,
        `/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/pending-permissions`
      )
    );
  }

  async resolvePendingPermission(params: {
    workspaceSessionId: string;
    toolCallId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
  }): Promise<boolean> {
    const out = await fetchJson<{ ok: boolean }>(
      asUrl(
        this.baseUrl,
        `/workspace-sessions/${encodeURIComponent(params.workspaceSessionId)}/pending-permissions/${encodeURIComponent(params.toolCallId)}`
      ),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: params.decision,
          ...(params.updatedInput ? { updatedInput: params.updatedInput } : {}),
        }),
      }
    );
    return out.ok;
  }

  async subscribeEvents(params: {
    signal?: AbortSignal;
    onEvent: (event: SupervisorServerEvent) => void | Promise<void>;
  }): Promise<void> {
    const res = await fetch(asUrl(this.baseUrl, '/events'), {
      headers: { accept: 'text/event-stream' },
      signal: params.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Failed to subscribe events: HTTP ${res.status}`);

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent: string | undefined;
    let currentData: string | undefined;

    const flush = async () => {
      if (!currentEvent || currentData === undefined) return;
      const parsed = JSON.parse(currentData) as unknown;
      void params.onEvent(parsed as SupervisorServerEvent);
      currentEvent = undefined;
      currentData = undefined;
    };

    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);

        if (!line) {
          await flush();
          continue;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          currentData = line.slice('data:'.length).trim();
          continue;
        }
      }
    }
  }
}
