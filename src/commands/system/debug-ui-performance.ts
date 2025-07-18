// ABOUTME: Debug UI performance command to display timeline processing performance metrics
// ABOUTME: Shows performance metrics from StreamingTimelineProcessor for monitoring O(1) behavior

import type { Command, UserInterface } from '~/commands/types';

export const debugUiPerformanceCommand: Command = {
  name: 'debug-ui-performance',
  description: 'Display timeline processing performance metrics',

  execute(args: string, ui: UserInterface): void {
    // Check if the UI supports performance metrics display
    if ('getPerformanceMetrics' in ui && typeof ui.getPerformanceMetrics === 'function') {
      const metrics = (
        ui as UserInterface & { getPerformanceMetrics(): string }
      ).getPerformanceMetrics();
      ui.displayMessage(`📊 Timeline Performance Metrics:\n\n${metrics}`);
    } else {
      ui.displayMessage('Performance metrics not supported in this interface');
    }
  },
};
