// ABOUTME: Queue management commands for viewing and clearing message queue
// ABOUTME: Provides /queue (show) and /queue clear functionality

import type { Command, UserInterface } from '~/commands/types';

export const queueCommand: Command = {
  name: 'queue',
  description: 'View message queue or clear queued messages',

  execute(args: string, ui: UserInterface): void {
    const trimmedArgs = args.trim();

    if (trimmedArgs === 'clear') {
      // Clear only user messages, preserve system/task notifications
      const clearedCount = ui.agent.clearQueue((msg) => msg.type === 'user');
      ui.displayMessage(
        `📬 Cleared ${clearedCount} user message${clearedCount === 1 ? '' : 's'} from queue`
      );
      return;
    }

    if (trimmedArgs === '') {
      // Show queue contents
      const stats = ui.agent.getQueueStats();

      if (stats.queueLength === 0) {
        ui.displayMessage('📬 Message queue is empty');
        return;
      }

      // Get queue contents using the proper Agent method
      const queueContents = ui.agent.getQueueContents();

      const messages = [
        `📬 Message Queue (${stats.queueLength} message${stats.queueLength === 1 ? '' : 's'})`,
        stats.highPriorityCount > 0 ? `   High priority: ${stats.highPriorityCount}` : null,
        stats.oldestMessageAge
          ? `   Oldest: ${Math.round(stats.oldestMessageAge / 1000)}s ago`
          : null,
        '',
        ...queueContents.map((msg, index) => {
          const priority = msg.metadata?.priority === 'high' ? ' [HIGH]' : '';
          const source = msg.metadata?.source ? ` (${msg.metadata.source})` : '';
          const preview =
            msg.content.length > 50 ? msg.content.substring(0, 47) + '...' : msg.content;
          return `${index + 1}. [${msg.type.toUpperCase()}]${priority} ${preview}${source}`;
        }),
        '',
        'Use /queue clear to remove user messages from queue',
      ].filter(Boolean);

      ui.displayMessage(messages.join('\n'));
      return;
    }

    // Invalid subcommand
    ui.displayMessage(
      'Usage: /queue [clear]\n  /queue      - Show queue contents\n  /queue clear - Clear user messages from queue'
    );
  },
};
