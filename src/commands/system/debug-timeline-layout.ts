// ABOUTME: Debug timeline layout command to toggle timeline layout debug panel visibility
// ABOUTME: Shows/hides the timeline layout debug panel that displays viewport state and item measurements

import type { Command, UserInterface } from '~/commands/types';

export const debugTimelineLayoutCommand: Command = {
  name: 'debug-timeline-layout',
  description: 'Toggle timeline layout debug panel visibility (default: off)',

  execute(args: string, ui: UserInterface): void {
    // Check if the UI supports timeline layout debug panel toggling
    if (
      'toggleTimelineLayoutDebugPanel' in ui &&
      typeof ui.toggleTimelineLayoutDebugPanel === 'function'
    ) {
      const isVisible = (
        ui as UserInterface & { toggleTimelineLayoutDebugPanel(): boolean }
      ).toggleTimelineLayoutDebugPanel();
      ui.displayMessage(`Timeline layout debug panel ${isVisible ? 'enabled' : 'disabled'}`);
    } else {
      ui.displayMessage('Timeline layout debug panel not supported in this interface');
    }
  },
};
