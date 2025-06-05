// ABOUTME: StatusBar component for displaying basic status information
// ABOUTME: Shows app name, status, and navigation hints at bottom of screen

import React from 'react';
import { Text, Box } from 'ink';

interface TokenUsage {
  used: number;
  total: number;
}

interface StatusBarProps {
  isNavigationMode?: boolean;
  scrollPosition?: number;
  totalMessages?: number;
  isLoading?: boolean;
  filterMode?: 'all' | 'conversation' | 'search';
  searchTerm?: string;
  isSearchMode?: boolean;
  searchResults?: { messageIndex: number; message: any }[];
  searchResultIndex?: number;
  tokenUsage?: TokenUsage;
  modelName?: string;
  terminalWidth?: number;
}

const StatusBar: React.FC<StatusBarProps> = ({ 
  isNavigationMode = false, 
  scrollPosition = 0, 
  totalMessages = 0,
  isLoading = false,
  filterMode = 'all',
  searchTerm = '',
  isSearchMode = false,
  searchResults = [],
  searchResultIndex = 0,
  tokenUsage,
  modelName,
  terminalWidth = 100
}) => {
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  };

  const getFilterText = () => {
    switch (filterMode) {
      case 'conversation':
        return 'conversation';
      case 'search':
        return searchTerm ? `'${searchTerm}'` : 'search';
      case 'all':
      default:
        return 'all';
    }
  };

  const isNarrowTerminal = terminalWidth < 80;
  const showFullInfo = terminalWidth >= 120;

  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text color="cyan">lace-ink</Text>
      <Text> | </Text>
      
      {/* Token usage display */}
      {tokenUsage && (
        <>
          <Text color="blue">
            Tokens: {formatTokens(tokenUsage.used)}/{formatTokens(tokenUsage.total)}
          </Text>
          <Text> | </Text>
        </>
      )}
      
      {/* Model name display */}
      {modelName && showFullInfo && (
        <>
          <Text color="green">{modelName}</Text>
          <Text> | </Text>
        </>
      )}
      {modelName && isNarrowTerminal && (
        <>
          <Text color="green">{modelName.split('-')[0] + '-3.5'}</Text>
          <Text> | </Text>
        </>
      )}
      {modelName && !showFullInfo && !isNarrowTerminal && (
        <>
          <Text color="green">{modelName}</Text>
          <Text> | </Text>
        </>
      )}
      
      <Text color="magenta">Filter: {getFilterText()}</Text>
      <Text> | </Text>
      {isSearchMode ? (
        <>
          <Text color="blue">Search</Text>
          <Text> | </Text>
          <Text color="dim">Type to search, Enter to execute, Esc to cancel</Text>
        </>
      ) : isNavigationMode ? (
        <>
          <Text color="yellow">Nav: j/k/c/a{filterMode === 'search' && searchResults.length > 0 ? '/n/N' : ''}</Text>
          <Text> | </Text>
          <Text color="dim">
            {filterMode === 'search' && searchResults.length > 0 
              ? `Result ${searchResultIndex + 1} of ${searchResults.length} | Line ${scrollPosition + 1} of ${totalMessages}`
              : `Line ${scrollPosition + 1} of ${totalMessages}`
            }
          </Text>
        </>
      ) : isLoading ? (
        <>
          <Text color="yellow">Thinking...</Text>
          <Text> | </Text>
          <Text color="dim">Please wait</Text>
        </>
      ) : (
        <>
          <Text color="green">Ready</Text>
          <Text> | </Text>
          <Text color="dim">↑/↓ to navigate, / to search</Text>
        </>
      )}
    </Box>
  );
};

export default StatusBar;