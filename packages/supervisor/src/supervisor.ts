import type { JsonRpcPeer } from '@lace/ent-protocol';
import { SupervisorAgentProcess, type PermissionDecision } from './supervisor-agent-process';

export type WorkspaceSessionHandle = {
  workspaceSessionId: string;
  sessionId: string;
  workDir: string;
  pid: number;
};

export type SupervisorOptions = {
  laceDir: string;
  onSessionUpdate?: (workspaceSessionId: string, update: Record<string, unknown>) => void;
  onPermissionRequest?: (
    workspaceSessionId: string,
    params: Record<string, unknown>
  ) => Promise<PermissionDecision>;
};

export class Supervisor {
  private readonly laceDir: string;
  private readonly sessions = new Map<
    string,
    {
      agent: SupervisorAgentProcess;
      sessionId: string;
      workDir: string;
    }
  >();
  private nextWorkspaceSessionId = 1;
  private readonly onSessionUpdate?: SupervisorOptions['onSessionUpdate'];
  private readonly onPermissionRequest?: SupervisorOptions['onPermissionRequest'];

  constructor(options: SupervisorOptions) {
    this.laceDir = options.laceDir;
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
  }

  async createWorkspaceSession(workDir: string): Promise<WorkspaceSessionHandle> {
    const workspaceSessionId = `ws_${this.nextWorkspaceSessionId++}`;

    const agent = new SupervisorAgentProcess({
      laceDir: this.laceDir,
      onSessionUpdate: (update) => {
        if (this.onSessionUpdate) this.onSessionUpdate(workspaceSessionId, update);
      },
      onPermissionRequest: async (params) => {
        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, params);
      },
    });

    await agent.peer.request('initialize', {
      protocolVersion: '1.0',
      config: { approvalMode: 'ask' },
    });

    const created = (await agent.peer.request('session/new', { workDir })) as { sessionId: string };

    this.sessions.set(workspaceSessionId, { agent, sessionId: created.sessionId, workDir });

    return {
      workspaceSessionId,
      sessionId: created.sessionId,
      workDir,
      pid: agent.proc.pid ?? -1,
    };
  }

  getPeer(workspaceSessionId: string): JsonRpcPeer {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return found.agent.peer;
  }

  async prompt(workspaceSessionId: string, content: unknown[]): Promise<unknown> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return await found.agent.peer.request('session/prompt', { content });
  }

  cancel(workspaceSessionId: string): void {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    found.agent.peer.notify('session/cancel');
  }

  async shutdownWorkspaceSession(workspaceSessionId: string): Promise<void> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) return;
    this.sessions.delete(workspaceSessionId);
    await found.agent.shutdown();
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.shutdownWorkspaceSession(id);
    }
  }
}
