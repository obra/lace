// ABOUTME: Session management for CLI thread persistence
// ABOUTME: Handles session startup, continuation, and graceful shutdown

import { ThreadManager } from './thread-manager.js';
import { getLaceDbPath } from '../config/lace-dir.js';

export function generateThreadId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `lace_${date}_${random}`;
}

export async function startSession(
  args: string[]
): Promise<{ threadManager: ThreadManager; threadId: string }> {
  const threadManager = new ThreadManager(getLaceDbPath());

  if (args.includes('--continue')) {
    const sessionIdArg = args.find((arg) => arg.startsWith('lace_'));
    const threadId = sessionIdArg || (await threadManager.getLatestThreadId());

    if (threadId) {
      try {
        await threadManager.setCurrentThread(threadId);
        console.log(`Continuing conversation ${threadId}`);
        return { threadManager, threadId };
      } catch {
        console.warn(`Could not resume ${threadId}, starting new session`);
      }
    }
  }

  // Start new session
  const threadId = generateThreadId();
  threadManager.createThread(threadId);
  threadManager.enableAutoSave();
  console.log(`Starting conversation ${threadId}`);

  return { threadManager, threadId };
}

export async function handleGracefulShutdown(threadManager: ThreadManager): Promise<void> {
  await threadManager.close();
}
