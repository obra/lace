import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureLaceDir } from '@lace/core/config/lace-dir';
import type { JsonRpcMethodHandler } from '@lace/ent-protocol';

export type AgentServerState = {
  initialized: boolean;
  activeSessionId: string | null;
};

export function createAgentServerState(): AgentServerState {
  return { initialized: false, activeSessionId: null };
}

function ensureAgentSessionsDir(): string {
  const laceDir = ensureLaceDir();
  const sessionsDir = path.join(laceDir, 'agent-sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return sessionsDir;
}

function writeSessionMeta(
  sessionDir: string,
  meta: { sessionId: string; workDir: string; created: string }
): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function createAgentRpcMethods(
  state: AgentServerState
): Record<string, JsonRpcMethodHandler> {
  return {
    initialize: async () => {
      state.initialized = true;
      return {
        protocolVersion: '1.0',
        agentInfo: { name: 'lace-agent', version: '0.1.0' },
        capabilities: {
          streaming: true,
          multiTurn: true,
          tools: [],
          'ent/contextInjection': false,
          'ent/backgroundJobs': false,
          'ent/fileCheckpointing': false,
          'ent/structuredOutput': false,
        },
      };
    },

    'session/new': async (params) => {
      if (!state.initialized) throw new Error('Not initialized');

      const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
      if (!parsed?.workDir) throw new Error('workDir is required');

      const sessionId = `sess_${randomUUID()}`;
      const created = new Date().toISOString();

      const sessionsDir = ensureAgentSessionsDir();
      const sessionDir = path.join(sessionsDir, sessionId);
      writeSessionMeta(sessionDir, { sessionId, workDir: parsed.workDir, created });

      state.activeSessionId = sessionId;

      return { sessionId, created };
    },
  };
}
