// ABOUTME: Debug panel for timeline rendering and measurement issues
// ABOUTME: Shows real-time viewport state, item positions, and expansion states

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Timeline } from '../../../timeline-types.js';
import { ViewportState } from '../events/hooks/useTimelineViewport.js';

interface RenderDebugPanelProps {
  isVisible: boolean;
  timeline: Timeline;
  viewportState: ViewportState;
  onClose: () => void;
}

export function RenderDebugPanel({
  isVisible,
  timeline,
  viewportState,
  onClose,
}: RenderDebugPanelProps) {
  const [updateCount, setUpdateCount] = useState(0);

  // Track updates
  useEffect(() => {
    setUpdateCount((prev) => prev + 1);
  }, [
    viewportState.itemPositions,
    viewportState.totalContentHeight,
    viewportState.measurementTrigger,
  ]);

  // Handle close key
  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        onClose();
      }
    },
    { isActive: isVisible }
  );

  if (!isVisible) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1} marginTop={1}>
      <Text color="yellow" bold>
        🐛 Render Debug Panel (ESC to close)
      </Text>
      <Text color="gray">
        Updates: {updateCount} | Measurement Trigger: {viewportState.measurementTrigger}
      </Text>

      <Box marginTop={1}>
        <Text color="cyan" bold>
          Viewport State:
        </Text>
      </Box>
      <Text>Selected Line: {viewportState.selectedLine}</Text>
      <Text>Selected Item: {viewportState.selectedItemIndex}</Text>
      <Text>Scroll Offset: {viewportState.lineScrollOffset}</Text>
      <Text>Total Height: {viewportState.totalContentHeight}</Text>

      <Box marginTop={1}>
        <Text color="cyan" bold>
          Timeline Items ({timeline.items.length}):
        </Text>
      </Box>
      {timeline.items.slice(0, 5).map((item, index) => {
        const position = viewportState.itemPositions[index] ?? '?';
        const nextPosition =
          viewportState.itemPositions[index + 1] ?? viewportState.totalContentHeight;
        const height =
          typeof position === 'number' && typeof nextPosition === 'number'
            ? nextPosition - position
            : '?';

        return (
          <Text key={index} color={index === viewportState.selectedItemIndex ? 'green' : 'white'}>
            [{index}] {item.type} @ pos:{position} h:{height}
            {index === viewportState.selectedItemIndex ? ' ← SELECTED' : ''}
          </Text>
        );
      })}

      {timeline.items.length > 5 && (
        <Text color="gray">... and {timeline.items.length - 5} more items</Text>
      )}

      <Box marginTop={1}>
        <Text color="cyan" bold>
          Item Positions:
        </Text>
      </Box>
      <Text>{viewportState.itemPositions.slice(0, 8).join(', ')}</Text>
      {viewportState.itemPositions.length > 8 && (
        <Text color="gray">... {viewportState.itemPositions.length - 8} more</Text>
      )}
    </Box>
  );
}
