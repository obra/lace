// ABOUTME: DetailedLogView component for displaying structured log entries
// ABOUTME: Uses virtual scrolling pattern similar to ConversationView for performance and includes log extraction logic

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { ConversationMessage } from "./messages/MessageContainer";

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
  conversation?: ConversationMessage[];
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

/**
 * Extract log entries from conversation messages for detailed log view
 * Converts ConversationMessage objects to DetailedLogEntry objects
 */
function extractLogEntries(conversation: ConversationMessage[]): DetailedLogEntry[] {
  const entries: DetailedLogEntry[] = [];
  let entryIndex = 0;

  conversation.forEach((message, messageIndex) => {
    const baseTimestamp = new Date().toISOString();
    
    // Add the main message entry
    let content: string;
    if (message.type === "agent_activity") {
      content = `${message.summary}\n${message.content.join('\n')}`;
    } else {
      content = message.content as string;
    }
    
    // Extract usage and timing data based on message type
    let usage: DetailedLogEntry['usage'] = undefined;
    let timing: DetailedLogEntry['timing'] = undefined;

    if (message.type === "assistant" && message.usage) {
      usage = {
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        totalTokens: message.usage.totalTokens,
      };
    } else if (message.type === "streaming" && message.usage) {
      usage = {
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        totalTokens: message.usage.totalTokens,
      };
    } else if (message.type === "agent_activity" && message.timing) {
      timing = {
        durationMs: message.timing.durationMs,
      };
    }

    entries.push({
      id: `log-${entryIndex++}-${baseTimestamp}`,
      timestamp: baseTimestamp,
      type: message.type as string,
      content,
      usage,
      timing,
    });

    // If this is an assistant message with tool calls, add separate tool call entries
    if (message.type === "assistant" && message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      message.tool_calls.forEach((toolCall, toolIndex) => {
        // Add tool call entry with mock timing data for demonstration
        const toolCallTimestamp = new Date(Date.parse(baseTimestamp) + toolIndex + 1).toISOString();
        
        // Mock timing data based on tool type (in real implementation, this would come from activity logger)
        const mockDuration = toolCall.name === "file" ? 50 + Math.random() * 100 : 
                           toolCall.name === "shell" ? 200 + Math.random() * 800 :
                           toolCall.name === "javascript" ? 100 + Math.random() * 500 :
                           75 + Math.random() * 150;
        
        entries.push({
          id: `log-${entryIndex++}-${toolCallTimestamp}`,
          timestamp: toolCallTimestamp,
          type: "tool_call",
          content: `Tool: ${toolCall.name}\nInput: ${JSON.stringify(toolCall.input, null, 2)}`,
          timing: {
            durationMs: Math.round(mockDuration),
          },
        });

        // For now, we don't have tool results in the conversation history
        // Tool results would need to be extracted from the agent response or activity logger
        // This is a placeholder for when tool results are available in conversation data
        // TODO: Extract tool results when they become available in conversation data
      });
    }
  });

  return entries;
}

const DetailedLogView: React.FC<DetailedLogViewProps> = ({
  scrollPosition = 0,
  isNavigationMode = false,
  entries = [],
  conversation = [],
}) => {
  // Extract log entries from conversation if conversation is provided, otherwise use entries prop
  const logEntries = useMemo(() => {
    return conversation.length > 0 ? extractLogEntries(conversation) : entries;
  }, [conversation, entries]);

  // Use virtual scrolling for large logs
  const { visibleEntries, startIndex } = getVisibleEntryWindow(
    logEntries,
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