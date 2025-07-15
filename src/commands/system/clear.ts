// ABOUTME: Clear command that starts a new conversation session
// ABOUTME: Recreates agent and thread, resets interface state

import type { Command, UserInterface } from '~/commands/types.js';

export const clearCommand: Command = {
  name: 'clear',
  description: 'Clear conversation back to system prompt',

  execute(args: string, ui: UserInterface): Promise<void> {
    ui.clearSession();
    ui.displayMessage('Conversation cleared');
    return Promise.resolve();
  },
};
