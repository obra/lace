// ABOUTME: StatusBar component for displaying basic status information
// ABOUTME: Shows app name, status, and navigation hints at bottom of screen

import React from "react";
import { Text, Box } from "ink";

interface TokenUsage {
  used: number;
  total: number;
}

interface StatusBarProps {
  isNavigationMode?: boolean;
  scrollPosition?: number;
  totalMessages?: number;
  isLoading?: boolean;
  isStreaming?: boolean;
  filterMode?: "all" | "conversation" | "search";
  searchTerm?: string;
  isSearchMode?: boolean;
  searchResults?: { messageIndex: number; message: any }[];
  searchResultIndex?: number;
  tokenUsage?: TokenUsage;
  modelName?: string;
  terminalWidth?: number;
  viewMode?: "conversation" | "log";
}

const StatusBar: React.FC<StatusBarProps> = ({
  isNavigationMode = false,
  scrollPosition = 0,
  totalMessages = 0,
  isLoading = false,
  isStreaming = false,
  filterMode = "all",
  searchTerm = "",
  isSearchMode = false,
  searchResults = [],
  searchResultIndex = 0,
  tokenUsage,
  modelName,
  terminalWidth = 100,
  viewMode = "conversation",
}) => {
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  };

  const getFilterText = () => {
    switch (filterMode) {
      case "conversation":
        return "conversation";
      case "search":
        return searchTerm ? `'${searchTerm}'` : "search";
      case "all":
      default:
        return "all";
    }
  };

  const isNarrowTerminal = terminalWidth < 80;
  const showFullInfo = terminalWidth >= 120;

  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text key="app-name" color="cyan">lace</Text>
      <Text key="sep1"> | </Text>
      <Text key="view-mode" color="yellow">
        {viewMode === 'conversation' ? 'Conversation Mode' : 'Log Mode'}
      </Text>
      <Text key="sep2"> | </Text>

      {/* Token usage display */}
      {tokenUsage && (
        <React.Fragment key="token-usage">
          <Text color="blue">
            Tokens: {formatTokens(tokenUsage.used)}/
            {formatTokens(tokenUsage.total)}
          </Text>
          <Text key="sep3"> | </Text>
        </React.Fragment>
      )}

      {/* Model name display */}
      {modelName && showFullInfo && (
        <React.Fragment key="model-full">
          <Text color="green">{modelName}</Text>
          <Text key="sep4"> | </Text>
        </React.Fragment>
      )}
      {modelName && isNarrowTerminal && (
        <React.Fragment key="model-narrow">
          <Text color="green">{modelName.split("-")[0] + "-3.5"}</Text>
          <Text key="sep5"> | </Text>
        </React.Fragment>
      )}
      {modelName && !showFullInfo && !isNarrowTerminal && (
        <React.Fragment key="model-default">
          <Text color="green">{modelName}</Text>
          <Text key="sep6"> | </Text>
        </React.Fragment>
      )}

      <Text key="filter-label" color="magenta">Filter: {getFilterText()}</Text>
      <Text key="sep7"> | </Text>
      {isSearchMode ? (
        <React.Fragment key="search-mode">
          <Text color="blue">Search</Text>
          <Text key="sep8"> | </Text>
          <Text color="dim">
            Type to search, Enter to execute, Esc to cancel
          </Text>
        </React.Fragment>
      ) : isNavigationMode ? (
        <React.Fragment key="nav-mode">
          <Text color="yellow">
            Nav: j/k/c/a
            {filterMode === "search" && searchResults.length > 0 ? "/n/N" : ""}
          </Text>
          <Text key="sep9"> | </Text>
          <Text color="dim">
            {filterMode === "search" && searchResults.length > 0
              ? `Result ${searchResultIndex + 1} of ${searchResults.length} | Line ${scrollPosition + 1} of ${totalMessages}`
              : `Line ${scrollPosition + 1} of ${totalMessages}`}
          </Text>
        </React.Fragment>
      ) : isLoading ? (
        <React.Fragment key="loading-mode">
          <Text color="yellow">Thinking...</Text>
          <Text key="sep10"> | </Text>
          <Text color="dim">Ctrl+C or Esc to cancel</Text>
        </React.Fragment>
      ) : isStreaming ? (
        <React.Fragment key="streaming-mode">
          <Text color="yellow">Streaming...</Text>
          <Text key="sep11"> | </Text>
          <Text color="dim">Ctrl+C or Esc to cancel</Text>
        </React.Fragment>
      ) : (
        <React.Fragment key="ready-mode">
          <Text color="green">Ready</Text>
          <Text key="sep12"> | </Text>
          <Text color="dim">↑/↓ to navigate, / to search, Ctrl+L to toggle view</Text>
        </React.Fragment>
      )}
    </Box>
  );
};

export default StatusBar;
