// ABOUTME: Status command that shows current session information
// ABOUTME: Displays thread ID, tool count, and provider info

import type { Command, UserInterface } from '../types.js';

export const statusCommand: Command = {
  name: 'status',
  description: 'Show current status',

  async execute(args: string, ui: UserInterface): Promise<void> {
    const threadId = ui.agent.getCurrentThreadId();
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
