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

function asUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error?: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
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
