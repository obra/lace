// ABOUTME: Session management for CLI thread persistence
// ABOUTME: Handles session startup, continuation, and graceful shutdown

import { ThreadManager } from './thread-manager.js';
import { getLaceDbPath } from '../config/lace-dir.js';

export function generateThreadId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `lace_${date}_${random}`;
}

export interface SessionInfo {
  threadManager: ThreadManager;
  threadId: string;
  isNewSession: boolean;
  isResumed: boolean;
  resumeError?: string;
}

export async function startSession(args: string[]): Promise<SessionInfo> {
  const threadManager = new ThreadManager(getLaceDbPath());

  if (args.includes('--continue')) {
    const sessionIdArg = args.find((arg) => arg.startsWith('lace_'));
    const threadId = sessionIdArg || (await threadManager.getLatestThreadId());

    if (threadId) {
      try {
        await threadManager.setCurrentThread(threadId);
        return {
          threadManager,
          threadId,
          isNewSession: false,
          isResumed: true,
        };
      } catch (error) {
        // Fall through to create new session
        const resumeError = error instanceof Error ? error.message : 'Unknown error';
        const newThreadId = generateThreadId();
        threadManager.createThread(newThreadId);
        threadManager.enableAutoSave();
        return {
          threadManager,
          threadId: newThreadId,
          isNewSession: true,
          isResumed: false,
          resumeError: `Could not resume ${threadId}: ${resumeError}`,
        };
      }
    }
  }

  // Start new session
  const threadId = generateThreadId();
  threadManager.createThread(threadId);
  threadManager.enableAutoSave();

  return {
    threadManager,
    threadId,
    isNewSession: true,
    isResumed: false,
  };
}

export async function handleGracefulShutdown(threadManager: ThreadManager): Promise<void> {
  await threadManager.close();
}
