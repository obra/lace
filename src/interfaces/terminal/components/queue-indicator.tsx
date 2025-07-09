// ABOUTME: Queue status indicator component for terminal UI
// ABOUTME: Shows message queue length and priority information

import React from 'react';
import { Text, Box } from 'ink';
import type { MessageQueueStats } from '../../../agents/types.js';

interface QueueIndicatorProps {
  stats: MessageQueueStats;
}

export const QueueIndicator: React.FC<QueueIndicatorProps> = ({ stats }) => {
  if (stats.queueLength === 0) {
    return null;
  }

  const baseText = `📬 ${stats.queueLength} queued`;
  const highPriorityText = stats.highPriorityCount > 0 
    ? ` (${stats.highPriorityCount} high)`
    : '';

  return (
    <Box>
      <Text color="yellow">
        {baseText}{highPriorityText}
      </Text>
    </Box>
  );
};