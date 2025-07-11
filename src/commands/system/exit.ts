// ABOUTME: Exit command that gracefully shuts down the application
// ABOUTME: Calls ui.exit() which handles interface-specific cleanup

import type { Command, UserInterface } from '~/commands/types.js';

export const exitCommand: Command = {
  name: 'exit',
  description: 'Exit the application',

  execute(args: string, ui: UserInterface): void {
    ui.exit();
  },
};
