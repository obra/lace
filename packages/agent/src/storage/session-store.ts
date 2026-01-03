import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureLaceDir } from '../config/lace-dir.js';

export type SessionMeta = {
  sessionId: string;
  workDir: string;
  created: string;
};

export type SessionState = {
  nextEventSeq: number;
  nextStreamSeq: number;
  pendingPermissions?: Array<{
    toolCallId: string;
    requestId?: string;
    turnId: string;
    turnSeq: number;
    jobId?: string;
    tool: string;
    kind?: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    requestedAt: string;
    input: Record<string, unknown>;
  }>;
};

export type LoadedSession = {
  meta: SessionMeta;
  dir: string;
  state: SessionState;
};

function agentSessionsDir(): string {
  const laceDir = ensureLaceDir();
  const sessionsDir = path.join(laceDir, 'agent-sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return sessionsDir;
}

export function getSessionDir(sessionId: string): string {
  return path.join(agentSessionsDir(), sessionId);
}

export function readSessionMeta(sessionDir: string): SessionMeta {
  const metaPath = path.join(sessionDir, 'meta.json');
  return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SessionMeta;
}

export function writeSessionMeta(sessionDir: string, meta: SessionMeta): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function readSessionState(sessionDir: string): SessionState {
  const statePath = path.join(sessionDir, 'state.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<SessionState>;
    return {
      nextEventSeq: typeof parsed.nextEventSeq === 'number' ? parsed.nextEventSeq : 1,
      nextStreamSeq: typeof parsed.nextStreamSeq === 'number' ? parsed.nextStreamSeq : 1,
      pendingPermissions: Array.isArray(parsed.pendingPermissions) ? parsed.pendingPermissions : [],
    };
  } catch {
    return { nextEventSeq: 1, nextStreamSeq: 1, pendingPermissions: [] };
  }
}

export function writeSessionState(sessionDir: string, state: SessionState): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'state.json'), JSON.stringify(state, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function ensureSessionFiles(sessionDir: string): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '', { encoding: 'utf8', mode: 0o600 });
  }
}

export function listSessions(workDir?: string): Array<{
  sessionId: string;
  created: string;
  lastActive: string;
  messageCount: number;
  workDir: string;
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
    .filter((s) => (workDir ? s.workDir === workDir : true));
}

export function loadSession(sessionId: string): LoadedSession {
  const sessionDir = getSessionDir(sessionId);
  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('Session not found');

  const meta = readSessionMeta(sessionDir);
  const state = readSessionState(sessionDir);
  ensureSessionFiles(sessionDir);
  return { meta, dir: sessionDir, state };
}
