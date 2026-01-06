import type {
  PendingPermission,
  SupervisorPermissionRequest,
  SupervisorSessionUpdate,
} from './http/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function permissionKey(agentSessionId: string, toolCallId: string): string {
  return `${agentSessionId}:${toolCallId}`;
}

export type PendingPermissionDecision = {
  decision: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
};

type PendingToolCall = {
  workspaceSessionId: string;
  agentSessionId: string;
  toolCallId: string;
  toolCall: { name: string; arguments: Record<string, unknown> };
  createdAt: number;
};

type PendingPermissionInternal = {
  workspaceSessionId: string;
  agentSessionId: string;
  toolCallId: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  request: SupervisorPermissionRequest;
  requestedAt: number;
  resolve: (decision: PendingPermissionDecision) => void;
};

export class PendingPermissionsTracker {
  private readonly timeoutMs: number;
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private readonly pendingPermissions = new Map<string, PendingPermissionInternal>();

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
  }

  onSessionUpdate(workspaceSessionId: string, update: SupervisorSessionUpdate): void {
    if (update.type !== 'tool_use') return;

    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    const name = typeof update.name === 'string' ? update.name : '';
    const input = isRecord(update.input) ? update.input : {};
    const status = typeof update.status === 'string' ? update.status : '';
    const agentSessionId = typeof update.sessionId === 'string' ? update.sessionId : '';

    if (!toolCallId || !name || !agentSessionId) return;
    if (status !== 'pending' && status !== 'awaiting_permission') return;

    const key = permissionKey(agentSessionId, toolCallId);
    this.pendingToolCalls.set(key, {
      workspaceSessionId,
      agentSessionId,
      toolCallId,
      toolCall: { name, arguments: input },
      createdAt: Date.now(),
    });
  }

  startPermissionRequest(
    workspaceSessionId: string,
    params: SupervisorPermissionRequest
  ): {
    toolCall?: { name: string; arguments: Record<string, unknown> };
    waitForDecision: Promise<PendingPermissionDecision>;
  } {
    const agentSessionId = params.sessionId;
    const toolCallId = params.toolCallId;
    const key = permissionKey(agentSessionId, toolCallId);

    const toolCallFromUpdates = this.pendingToolCalls.get(key);
    const toolCall =
      toolCallFromUpdates &&
      toolCallFromUpdates.workspaceSessionId === workspaceSessionId &&
      toolCallFromUpdates.agentSessionId === agentSessionId
        ? toolCallFromUpdates.toolCall
        : undefined;

    this.pendingToolCalls.delete(key);

    const existing = this.pendingPermissions.get(key);
    if (existing) {
      this.pendingPermissions.delete(key);
      existing.resolve({ decision: 'deny' });
    }

    const waitForDecision = new Promise<PendingPermissionDecision>((resolve) => {
      this.pendingPermissions.set(key, {
        workspaceSessionId,
        agentSessionId,
        toolCallId,
        ...(toolCall ? { toolCall } : {}),
        request: params,
        requestedAt: Date.now(),
        resolve,
      });

      const timeout = setTimeout(() => {
        const still = this.pendingPermissions.get(key);
        if (!still) return;
        this.pendingPermissions.delete(key);
        this.pendingToolCalls.delete(key);
        still.resolve({ decision: 'deny' });
      }, this.timeoutMs);

      timeout.unref?.();
    });

    return { ...(toolCall ? { toolCall } : {}), waitForDecision };
  }

  listPendingPermissions(workspaceSessionId: string): PendingPermission[] {
    const out: PendingPermission[] = Array.from(this.pendingPermissions.values())
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
    return out;
  }

  resolvePendingPermission(params: {
    workspaceSessionId: string;
    toolCallId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
  }): { ok: boolean; error?: 'ambiguous' } {
    const candidates = Array.from(this.pendingPermissions.values()).filter(
      (p) =>
        p.workspaceSessionId === params.workspaceSessionId && p.toolCallId === params.toolCallId
    );

    if (candidates.length === 0) return { ok: false };
    if (candidates.length > 1) return { ok: false, error: 'ambiguous' };

    const found = candidates[0]!;
    const key = permissionKey(found.agentSessionId, found.toolCallId);
    this.pendingPermissions.delete(key);
    this.pendingToolCalls.delete(key);

    found.resolve({
      decision: params.decision,
      ...(params.updatedInput ? { updatedInput: params.updatedInput } : {}),
    });

    return { ok: true };
  }

  clearWorkspace(workspaceSessionId: string): void {
    for (const [key, pending] of this.pendingPermissions.entries()) {
      if (pending.workspaceSessionId !== workspaceSessionId) continue;
      this.pendingPermissions.delete(key);
      pending.resolve({ decision: 'deny' });
    }

    for (const [key, pending] of this.pendingToolCalls.entries()) {
      if (pending.workspaceSessionId !== workspaceSessionId) continue;
      this.pendingToolCalls.delete(key);
    }
  }

  shutdown(): void {
    for (const [key, pending] of this.pendingPermissions.entries()) {
      this.pendingPermissions.delete(key);
      pending.resolve({ decision: 'deny' });
    }

    this.pendingToolCalls.clear();
  }
}
