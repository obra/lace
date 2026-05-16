import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getLaceDir } from '../config/lace-dir';
import { asSessionId } from '@lace/ent-protocol';
import { deriveNextEventSeqFromEventLog, summarizeDurableEvents } from './event-log';
import { atomicWriteJson } from './atomic-write';
import { SessionStorageError } from '../errors/agent-errors';

export type SessionMeta = {
  sessionId: string;
  workDir: string;
  created: string;
};

export type SessionState = {
  nextEventSeq: number;
  nextStreamSeq: number;
  /** Accumulated token usage cost in USD for this session */
  sessionCostUsd?: number;
  /** Token usage tracking */
  tokenUsage?: {
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  config?: {
    executionMode?: 'plan' | 'execute';
    approvalMode?:
      | 'ask'
      | 'approveReads'
      | 'approveEdits'
      | 'approve'
      | 'deny'
      | 'dangerouslySkipPermissions';
    connectionId?: string;
    modelId?: string;
    maxBudgetUsd?: number;
    maxThinkingTokens?: number;
    environment?: Record<string, string>;
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      transport?: 'stdio' | 'sse' | 'http';
      enabled?: boolean;
      tools?: Record<string, 'allow' | 'ask' | 'deny' | 'disable'>;
    }>;
    /** Allowlist of tool names for this session; undefined means no scope filter. */
    toolScope?: string[];
  };
};

export type LoadedSession = {
  meta: SessionMeta;
  dir: string;
  state: SessionState;
};

function agentSessionsDir(): string {
  const override = process.env.LACE_SESSION_DIR?.trim();
  const candidates: string[] = [];

  if (override) {
    candidates.push(override);
  } else {
    candidates.push(path.join(getLaceDir(), 'agent-sessions'));

    const xdg = process.env.XDG_STATE_HOME?.trim();
    if (xdg) candidates.push(path.join(xdg, 'lace', 'agent-sessions'));

    const home = process.env.HOME?.trim();
    if (home) candidates.push(path.join(home, '.local', 'state', 'lace', 'agent-sessions'));

    candidates.push(path.join(os.tmpdir(), 'lace', 'agent-sessions'));
  }

  let lastError: unknown = undefined;
  for (const sessionsDir of candidates) {
    try {
      fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
      return sessionsDir;
    } catch (error) {
      lastError = error;
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new SessionStorageError(`Session storage unavailable: ${msg}`, candidates[0]);
}

export function getSessionDir(sessionId: string): string {
  return path.join(agentSessionsDir(), asSessionId(sessionId));
}

export function readSessionMeta(sessionDir: string): SessionMeta {
  const metaPath = path.join(sessionDir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SessionMeta;
  asSessionId(meta.sessionId);
  return meta;
}

export function writeSessionMeta(sessionDir: string, meta: SessionMeta): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  atomicWriteJson(path.join(sessionDir, 'meta.json'), meta, { mode: 0o600 });
}

export function readSessionState(sessionDir: string): SessionState {
  const statePath = path.join(sessionDir, 'state.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<SessionState>;
    return {
      nextEventSeq: typeof parsed.nextEventSeq === 'number' ? parsed.nextEventSeq : 1,
      nextStreamSeq: typeof parsed.nextStreamSeq === 'number' ? parsed.nextStreamSeq : 1,
      sessionCostUsd: typeof parsed.sessionCostUsd === 'number' ? parsed.sessionCostUsd : undefined,
      tokenUsage:
        typeof parsed.tokenUsage === 'object' && parsed.tokenUsage
          ? {
              totalInputTokens: parsed.tokenUsage.totalInputTokens ?? 0,
              totalOutputTokens: parsed.tokenUsage.totalOutputTokens ?? 0,
            }
          : undefined,
      config: typeof parsed.config === 'object' && parsed.config ? parsed.config : undefined,
    };
  } catch {
    return { nextEventSeq: 1, nextStreamSeq: 1 };
  }
}

export function writeSessionState(sessionDir: string, state: SessionState): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  atomicWriteJson(path.join(sessionDir, 'state.json'), state, { mode: 0o600 });
}

export function ensureSessionFiles(sessionDir: string): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '', { encoding: 'utf8', mode: 0o600 });
  }
}

// ACP-aligned: workDir→cwd, lastActive→updatedAt
export function listSessions(cwd?: string): Array<{
  sessionId: string;
  cwd: string;
  created: string;
  updatedAt: string;
  messageCount: number;
}> {
  const sessionsDir = agentSessionsDir();
  const sessionIds = fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  return sessionIds
    .map((sessionId) => {
      try {
        const sessionDir = path.join(sessionsDir, sessionId);
        const meta = readSessionMeta(sessionDir);
        const summary = summarizeDurableEvents(sessionDir);
        return {
          sessionId: meta.sessionId,
          cwd: meta.workDir, // ACP field name
          created: meta.created,
          updatedAt: summary.lastActive ?? meta.created, // ACP field name
          messageCount: summary.messageCount,
        };
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => !!s)
    .filter((s) => (cwd ? s.cwd === cwd : true));
}

export function loadSession(sessionId: string): LoadedSession {
  const sessionDir = getSessionDir(sessionId);
  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('Session not found');

  const meta = readSessionMeta(sessionDir);
  const state = readSessionState(sessionDir);
  ensureSessionFiles(sessionDir);

  // events.jsonl is the durable source of truth; repair state.nextEventSeq on load.
  const repairedNextEventSeq = deriveNextEventSeqFromEventLog(sessionDir);
  if (state.nextEventSeq !== repairedNextEventSeq) {
    state.nextEventSeq = repairedNextEventSeq;
    writeSessionState(sessionDir, state);
  }

  return { meta, dir: sessionDir, state };
}
