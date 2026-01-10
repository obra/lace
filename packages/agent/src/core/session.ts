// ABOUTME: Core Session class - represents an active conversation session
// Wraps the session-store persistence layer for clean library API

import { randomUUID } from 'node:crypto';
import {
  getSessionDir,
  writeSessionMeta,
  writeSessionState,
  ensureSessionFiles,
  loadSession as loadSessionFromStore,
  listSessions as listSessionsFromStore,
  type SessionMeta,
  type SessionState,
} from '@lace/agent/storage/session-store';
import type { SessionConfig, PromptParams, TurnResult, SessionUpdateHandler } from './types';

export class Session {
  readonly sessionId: string;
  readonly cwd: string;
  readonly sessionDir: string;
  private sessionState: SessionState;

  private constructor(sessionId: string, cwd: string, sessionDir: string, state: SessionState) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.sessionDir = sessionDir;
    this.sessionState = state;
  }

  /**
   * Create a new session with the given configuration
   */
  static create(config: SessionConfig): Session {
    const sessionId = `sess_${randomUUID()}`;
    const sessionDir = getSessionDir(sessionId);

    const meta: SessionMeta = {
      sessionId,
      workDir: config.cwd,
      created: new Date().toISOString(),
    };

    const state: SessionState = {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      config: {
        connectionId: config.connectionId,
        modelId: config.modelId,
        environment: config.env,
      },
    };

    // Persist session files
    writeSessionMeta(sessionDir, meta);
    writeSessionState(sessionDir, state);
    ensureSessionFiles(sessionDir);

    return new Session(sessionId, config.cwd, sessionDir, state);
  }

  /**
   * Load an existing session by ID
   */
  static load(sessionId: string): Session {
    const loaded = loadSessionFromStore(sessionId);
    return new Session(sessionId, loaded.meta.workDir, loaded.dir, loaded.state);
  }

  /**
   * List all available sessions, optionally filtered by cwd
   */
  static list(cwd?: string): Array<{
    sessionId: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }> {
    const sessions = listSessionsFromStore(cwd);
    return sessions.map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      createdAt: s.created,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount,
    }));
  }

  /**
   * Send a prompt to the session and get a response
   * @throws Error - Not implemented yet (Phase 3)
   */
  async prompt(_params: PromptParams, _onUpdate?: SessionUpdateHandler): Promise<TurnResult> {
    throw new Error('Not implemented: prompt() will be added in Phase 3');
  }

  /**
   * Cancel any in-progress operation
   * @throws Error - Not implemented yet (Phase 3)
   */
  cancel(): void {
    throw new Error('Not implemented: cancel() will be added in Phase 3');
  }
}
