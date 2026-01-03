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

    'ent/agent/ping': async () => {
      if (!state.initialized) throw new Error('Not initialized');
      return { ok: true, timestamp: new Date().toISOString() };
    },

    'ent/agent/status': async () => {
      if (!state.initialized) throw new Error('Not initialized');
      return {
        models: [],
        mcpServers: [],
        currentSession: state.activeSessionId
          ? {
              sessionId: state.activeSessionId,
              messageCount: 0,
              tokensUsed: 0,
              costUsd: 0,
            }
          : undefined,
        pendingPermissions: [],
        limits: {
          budgetUsedUsd: 0,
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

    'session/list': async (params) => {
      if (!state.initialized) throw new Error('Not initialized');

      const parsed = params as { workDir?: string } | undefined;
      const workDirFilter = parsed?.workDir;

      const sessionsDir = ensureAgentSessionsDir();
      const sessionIds = fs
        .readdirSync(sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      const sessions = sessionIds
        .map((sessionId) => {
          const metaPath = path.join(sessionsDir, sessionId, 'meta.json');
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
              sessionId: string;
              workDir: string;
              created: string;
            };

            return {
              sessionId: meta.sessionId,
              created: meta.created,
              lastActive: meta.created,
              messageCount: 0,
              workDir: meta.workDir,
            };
          } catch {
            return null;
          }
        })
        .filter((s): s is NonNullable<typeof s> => !!s)
        .filter((s) => (workDirFilter ? s.workDir === workDirFilter : true));

      return { sessions };
    },

    'session/load': async (params) => {
      if (!state.initialized) throw new Error('Not initialized');

      const parsed = params as { sessionId: string; fork?: boolean };
      if (!parsed?.sessionId) throw new Error('sessionId is required');
      if (parsed.fork) throw new Error('fork not implemented');

      const sessionsDir = ensureAgentSessionsDir();
      const metaPath = path.join(sessionsDir, parsed.sessionId, 'meta.json');
      if (!fs.existsSync(metaPath)) throw new Error('Session not found');

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { created: string };

      state.activeSessionId = parsed.sessionId;
      return {
        sessionId: parsed.sessionId,
        messageCount: 0,
        lastActive: meta.created,
      };
    },
  };
}
