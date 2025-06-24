// ABOUTME: Clear command that starts a new conversation session
// ABOUTME: Recreates agent and thread, resets interface state

import type { Command, UserInterface } from '../types.js';

export const clearCommand: Command = {
  name: 'clear',
  description: 'Clear conversation back to system prompt',

  async execute(args: string, ui: UserInterface): Promise<void> {
    ui.clearSession();
    ui.displayMessage('Conversation cleared');
  },
};
