// ABOUTME: DetailedLogView component for displaying structured log entries
// ABOUTME: Uses virtual scrolling pattern similar to ConversationView for performance

import React from "react";
import { Box, Text } from "ink";

export interface DetailedLogEntry {
  id: string;
  timestamp: string;
  type: string;
  content: string;
}

interface DetailedLogViewProps {
  scrollPosition?: number;
  isNavigationMode?: boolean;
  entries?: DetailedLogEntry[];
}

/**
 * Calculate the visible window of entries for virtual scrolling
 * Only renders entries around the current scroll position to improve performance
 */
function getVisibleEntryWindow(
  entries: DetailedLogEntry[],
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

/**
 * Get color for entry type based on the spec
 */
function getEntryTypeColor(type: string): string {
  switch (type) {
    case "user":
      return "blue";
    case "assistant":
    case "streaming":
      return "green";
    case "tool_call":
      return "magenta";
    case "tool_result":
      return "yellow";
    case "loading":
      return "cyan";
    case "agent_activity":
      return "gray";
    default:
      return "white";
  }
}

/**
 * Get visual prefix for entry type
 */
function getEntryTypePrefix(type: string): string {
  switch (type) {
    case "user":
      return "[USER]";
    case "assistant":
    case "streaming":
      return "[MODEL]";
    case "tool_call":
      return "[TOOL→]";
    case "tool_result":
      return "[TOOL←]";
    case "loading":
      return "[LOAD]";
    case "agent_activity":
      return "[AGENT]";
    default:
      return `[${type.toUpperCase()}]`;
  }
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
        const typeColor = getEntryTypeColor(entry.type);
        const typePrefix = getEntryTypePrefix(entry.type);
        
        return (
          <Box 
            key={entry.id}
            flexDirection="column"
            marginBottom={1}
            {...(isHighlighted && { backgroundColor: "blue" })}
          >
            <Box>
              <Text color="dim">
                [{new Date(entry.timestamp).toLocaleTimeString()}]
              </Text>
              <Text 
                color={typeColor} 
                bold
              >
                {" "}{typePrefix}: 
              </Text>
            </Box>
            <Text 
              color={isHighlighted ? "white" : undefined}
            >
              {entry.content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

export default DetailedLogView;