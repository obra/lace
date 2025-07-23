// ABOUTME: Status command that shows current session information
// ABOUTME: Displays thread ID, tool count, and provider info

import type { Command, UserInterface } from '~/commands/types';

export const statusCommand: Command = {
  name: 'status',
  description: 'Show current status',

  execute(args: string, ui: UserInterface): void {
    const threadId = ui.agent.getThreadId();
    const toolCount = ui.agent.toolExecutor.getAllTools().length;
    const providerName = ui.agent.providerName;

    const statusText = [
      `Provider: ${providerName}`,
      `Thread: ${threadId || 'none'}`,
      `Tools: ${toolCount} available`,
    ].join('\n');

    ui.displayMessage(statusText);
  },
};
