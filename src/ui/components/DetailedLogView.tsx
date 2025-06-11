// ABOUTME: DetailedLogView component for displaying structured log entries
// ABOUTME: Uses virtual scrolling pattern similar to ConversationView for performance

import React from "react";
import { Box, Text } from "ink";

interface DetailedLogViewProps {
  scrollPosition?: number;
  isNavigationMode?: boolean;
  entries?: string[];
}

/**
 * Calculate the visible window of entries for virtual scrolling
 * Only renders entries around the current scroll position to improve performance
 */
function getVisibleEntryWindow(
  entries: string[],
  scrollPosition: number,
  windowSize: number = 50,
) {
  // For small logs, render all entries
  if (entries.length <= windowSize) {
    return {
      visibleEntries: entries,
      startIndex: 0,
      endIndex: entries.length - 1,
    };
  }

  // Calculate window bounds around scroll position
  const halfWindow = Math.floor(windowSize / 2);
  const startIndex = Math.max(0, scrollPosition - halfWindow);
  const endIndex = Math.min(entries.length - 1, scrollPosition + halfWindow);

  // Extract visible slice
  const visibleEntries = entries.slice(startIndex, endIndex + 1);

  return {
    visibleEntries,
    startIndex,
    endIndex,
  };
}

const DetailedLogView: React.FC<DetailedLogViewProps> = ({
  scrollPosition = 0,
  isNavigationMode = false,
  entries = [],
}) => {
  // Use virtual scrolling for large logs
  const { visibleEntries, startIndex } = getVisibleEntryWindow(
    entries,
    scrollPosition,
  );

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      {visibleEntries.map((entry, relativeIndex) => {
        const absoluteIndex = startIndex + relativeIndex;
        const isHighlighted = isNavigationMode && absoluteIndex === scrollPosition;
        
        return (
          <Box key={`log-entry-${absoluteIndex}`}>
            <Text
              backgroundColor={isHighlighted ? "blue" : undefined}
              color={isHighlighted ? "white" : undefined}
            >
              {entry}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

export default DetailedLogView;