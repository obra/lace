// ABOUTME: Debug focus command to toggle focus debug panel visibility
// ABOUTME: Shows/hides the focus debug panel that displays focus stack and state

import type { Command, UserInterface } from '~/commands/types.js';

export const debugFocusCommand: Command = {
  name: 'debug-focus',
  description: 'Toggle focus debug panel visibility (default: off)',

  execute(args: string, ui: UserInterface): void {
    // Check if the UI supports focus debug panel toggling
    if ('toggleFocusDebugPanel' in ui && typeof ui.toggleFocusDebugPanel === 'function') {
      const isVisible = (
        ui as UserInterface & { toggleFocusDebugPanel(): boolean }
      ).toggleFocusDebugPanel();
      ui.displayMessage(`Focus debug panel ${isVisible ? 'enabled' : 'disabled'}`);
    } else {
      ui.displayMessage('Focus debug panel not supported in this interface');
    }
  },
};
