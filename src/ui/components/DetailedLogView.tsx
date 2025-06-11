// ABOUTME: DetailedLogView component for displaying structured log entries
// ABOUTME: Uses virtual scrolling pattern similar to ConversationView for performance

import React from "react";
import { Box, Text } from "ink";

export interface DetailedLogEntry {
  id: string;
  timestamp: string;
  type: string;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  timing?: {
    durationMs?: number;
  };
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

/**
 * Format token count with K/M suffixes for readability
 */
function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Format token usage display: (1.2K→456 tokens)
 */
function formatTokenUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): string {
  const { inputTokens, outputTokens, totalTokens } = usage;
  
  if (inputTokens !== undefined && outputTokens !== undefined) {
    const inputStr = formatTokenCount(inputTokens);
    const outputStr = formatTokenCount(outputTokens);
    return `(${inputStr}→${outputStr} tokens)`;
  } else if (totalTokens !== undefined) {
    return `(${formatTokenCount(totalTokens)} tokens)`;
  }
  
  return "";
}

/**
 * Format timing display: (123ms) or (1.2s)
 */
function formatTiming(timing: { durationMs?: number }): string {
  const { durationMs } = timing;
  
  if (durationMs === undefined) {
    return "";
  }
  
  if (durationMs >= 1000) {
    return `(${(durationMs / 1000).toFixed(1)}s)`;
  }
  
  return `(${Math.round(durationMs)}ms)`;
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
              {/* Display usage and timing data inline */}
              {entry.usage && (
                <Text color="cyan">
                  {formatTokenUsage(entry.usage)}{" "}
                </Text>
              )}
              {entry.timing && (
                <Text color="yellow">
                  {formatTiming(entry.timing)}{" "}
                </Text>
              )}
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