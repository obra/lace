// ABOUTME: Compact command that compresses thread history to save tokens
// ABOUTME: Uses existing threadManager.compact() functionality

import type { Command, UserInterface } from '../types.js';
import { ThreadEvent } from '../../threads/types.js';
export const compactCommand: Command = {
  name: 'compact',
  description: 'Compress thread history to save tokens',

  async execute(args: string, ui: UserInterface): Promise<void> {
    const threadId = ui.agent.threadManager.getCurrentThreadId();
    if (!threadId) {
      ui.displayMessage('❌ No active thread to compact');
      return;
    }

    ui.agent.threadManager.compact(threadId);

    // Get the system message that was added
    const events = ui.agent.threadManager.getEvents(threadId);
    const systemMessage = events.find(
      (e: ThreadEvent) =>
        e.type === 'LOCAL_SYSTEM_MESSAGE' &&
        typeof e.data === 'string' &&
        e.data.includes('Compacted')
    );

    if (systemMessage && typeof systemMessage.data === 'string') {
      ui.displayMessage(`✅ ${systemMessage.data}`);
    } else {
      ui.displayMessage(`✅ Compacted thread ${threadId}`);
    }
  },
};
