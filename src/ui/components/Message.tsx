// ABOUTME: Message component for displaying individual conversation messages
// ABOUTME: Handles user and assistant messages with appropriate prefixes and styling

import React from "react";
import { Text, Box } from "ink";
import { processContentWithHighlighting } from "../utils/syntax-highlight";
import { highlightSearchTerm } from "../utils/search-highlight";

interface MessageProps {
  type: "user" | "assistant" | "loading" | "agent_activity" | "streaming";
  content: string | string[];
  summary?: string;
  folded?: boolean;
  isHighlighted?: boolean;
  searchTerm?: string;
  isSearchResult?: boolean;
  isStreaming?: boolean;
}

const Message: React.FC<MessageProps> = ({
  type,
  content,
  summary,
  folded = false,
  isHighlighted = false,
  searchTerm = "",
  isSearchResult = false,
  isStreaming = false,
}) => {
  const getPrefix = () => {
    if (type === "user") return "> ";
    if (type === "assistant") return "🤖 ";
    if (type === "streaming") return "🤖 ";
    if (type === "loading") return "⠋ ";
    if (type === "agent_activity") return folded ? "▶ " : "▼ ";
    return "";
  };

  const getPrefixColor = () => {
    if (type === "user") return "cyan";
    if (type === "assistant") return "green";
    if (type === "streaming") return "green";
    if (type === "loading") return "yellow";
    if (type === "agent_activity") return "blue";
    return "white";
  };

  const prefix = getPrefix();
  const prefixColor = getPrefixColor();

  const renderContent = () => {
    if (type === "agent_activity") {
      const displaySummary =
        searchTerm && summary
          ? highlightSearchTerm(summary, searchTerm)
          : summary;

      if (folded) {
        // Show only summary when folded
        return (
          <Box>
            <Text color={prefixColor}>{prefix}</Text>
            <Text inverse={isHighlighted}>{displaySummary}</Text>
          </Box>
        );
      } else {
        // Show full content when unfolded
        return (
          <Box flexDirection="column">
            <Box>
              <Text color={prefixColor}>{prefix}</Text>
              <Text inverse={isHighlighted}>{displaySummary}</Text>
            </Box>
            {Array.isArray(content) &&
              content.map((item, index) => {
                const displayItem = searchTerm
                  ? highlightSearchTerm(item, searchTerm)
                  : item;
                return (
                  <Box
                    key={`content-item-${index}-${item.slice(0, 20).replace(/[^a-zA-Z0-9]/g, "_")}`}
                  >
                    <Text> {displayItem}</Text>
                  </Box>
                );
              })}
          </Box>
        );
      }
    } else if (type === "loading") {
      // Loading message with spinner
      return (
        <Box>
          <Text color={prefixColor}>{prefix}</Text>
          <Text inverse={isHighlighted}>⠋ {content}</Text>
        </Box>
      );
    } else {
      // Regular message types (user, assistant, streaming)
      let displayContent =
        (type === "assistant" || type === "streaming") &&
        typeof content === "string"
          ? processContentWithHighlighting(content)
          : content;

      // Apply search highlighting if search term exists and content is string
      if (searchTerm && typeof displayContent === "string") {
        displayContent = highlightSearchTerm(displayContent, searchTerm);
      }

      // Add cursor indicator for streaming messages
      const showCursor = type === "streaming" && isStreaming;

      return (
        <Box>
          <Text color={prefixColor}>{prefix}</Text>
          <Text inverse={isHighlighted}>{displayContent}</Text>
          {showCursor && <Text color="white">▌</Text>}
        </Box>
      );
    }
  };

  return (
    <Box flexDirection="column">
      {renderContent()}
      {type === "agent_activity" && folded ? (
        <Text>{""}</Text>
      ) : (
        <Text>{""}</Text>
      )}
    </Box>
  );
};

export default Message;
