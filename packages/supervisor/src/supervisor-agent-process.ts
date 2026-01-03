import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
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
    const resolved = resolveAgentPaths(options.agentPath);
    const agentMainPath = resolved.agentMainPath;
    const agentCwd = resolved.agentCwd;

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

function resolveAgentPaths(agentPathOverride?: string): {
  agentMainPath: string;
  agentCwd: string;
} {
  if (agentPathOverride) {
    const resolvedMain = resolvePath(agentPathOverride);
    const cwd = resolvePath(resolvedMain, '../..');
    return { agentMainPath: resolvedMain, agentCwd: cwd };
  }

  const fromFileUrl = tryResolveFromImportMetaUrl();
  if (fromFileUrl) return fromFileUrl;

  const fromCwd = tryResolveFromCwd();
  if (fromCwd) return fromCwd;

  throw new Error('Could not resolve lace agent entrypoint (packages/agent/dist/main.js)');
}

function tryResolveFromImportMetaUrl(): { agentMainPath: string; agentCwd: string } | null {
  try {
    const base = new URL(import.meta.url);
    if (base.protocol !== 'file:') return null;

    const agentMainUrl = new URL('../../agent/dist/main.js', base);
    const agentCwdUrl = new URL('../../agent', base);

    if (agentMainUrl.protocol !== 'file:' || agentCwdUrl.protocol !== 'file:') return null;

    const agentMainPath = fileURLToPath(agentMainUrl);
    const agentCwd = fileURLToPath(agentCwdUrl);
    return { agentMainPath, agentCwd };
  } catch {
    return null;
  }
}

function tryResolveFromCwd(): { agentMainPath: string; agentCwd: string } | null {
  const bases = [
    process.cwd(),
    resolvePath(process.cwd(), '..'),
    resolvePath(process.cwd(), '../..'),
    resolvePath(process.cwd(), '../../..'),
  ];

  for (const base of bases) {
    const agentCwd = join(base, 'packages', 'agent');
    const agentMainPath = join(agentCwd, 'dist', 'main.js');
    if (existsSync(agentMainPath)) return { agentMainPath, agentCwd };
  }

  return null;
}
