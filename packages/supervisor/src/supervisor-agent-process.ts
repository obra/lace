import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';

export type PermissionDecision = {
  decision: string;
  updatedInput?: Record<string, unknown>;
};

export type SupervisorAgentProcessOptions = {
  laceDir: string;
  agentPath?: string;
  onSessionUpdate?: (update: Record<string, unknown>) => void;
  onPermissionRequest?: (params: Record<string, unknown>) => Promise<PermissionDecision>;
};

export class SupervisorAgentProcess {
  readonly peer: JsonRpcPeer;
  readonly proc: ChildProcessWithoutNullStreams;

  private readonly transportClose: () => void;

  constructor(options: SupervisorAgentProcessOptions) {
    const agentMainPath =
      options.agentPath ?? fileURLToPath(new URL('../../agent/dist/main.js', import.meta.url));
    const agentCwd = fileURLToPath(new URL('../../agent', import.meta.url));

    this.proc = spawn(process.execPath, [agentMainPath], {
      cwd: agentCwd,
      env: { ...process.env, LACE_DIR: options.laceDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const transport = createNdjsonStdioTransport({
      readable: this.proc.stdout,
      writable: this.proc.stdin,
    });
    this.transportClose = transport.close;
    this.peer = new JsonRpcPeer(transport, { idPrefix: 'c_' });

    this.peer.onRequest('session/update', async (params) => {
      if (options.onSessionUpdate) options.onSessionUpdate(params as Record<string, unknown>);
      return undefined;
    });

    this.peer.onRequest('session/request_permission', async (params) => {
      if (!options.onPermissionRequest) return { decision: 'deny' };
      return await options.onPermissionRequest(params as Record<string, unknown>);
    });
  }

  async shutdown(): Promise<void> {
    this.peer.close();
    this.transportClose();

    if (this.proc.exitCode !== null) return;

    this.proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      this.proc.once('exit', () => resolve());
    });
  }
}
