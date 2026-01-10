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
import { ConversationRunner } from './conversation/runner';
import type { AIProvider } from '@lace/agent/providers/base-provider';
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

  private runner: ConversationRunner | null = null;

  /**
   * Send a prompt to the session and get a response
   * @param params - Prompt parameters including content
   * @param provider - AI provider to use for generation
   * @param onUpdate - Optional callback for streaming updates
   */
  async prompt(
    params: PromptParams,
    provider: AIProvider,
    onUpdate?: SessionUpdateHandler
  ): Promise<TurnResult> {
    this.runner = new ConversationRunner({
      sessionDir: this.sessionDir,
      cwd: this.cwd,
      onUpdate: onUpdate ?? (() => {}),
      connectionId: this.sessionState.config?.connectionId,
      modelId: this.sessionState.config?.modelId,
      environment: this.sessionState.config?.environment,
    });

    const result = await this.runner.run({
      content: params.content,
      provider,
      outputFormat: params.outputFormat,
    });

    return {
      turnId: result.turnId,
      stopReason: result.stopReason,
      content: result.content,
      usage: result.usage,
    };
  }

  /**
   * Cancel any in-progress operation
   */
  cancel(): void {
    if (this.runner) {
      this.runner.cancel();
    }
  }
}
