// ABOUTME: Specialized renderer for ripgrep-search tool executions with grouped match display
// ABOUTME: Shows search results grouped by file with line numbers and highlighted matches

import React from 'react';
import { Box, Text } from 'ink';
import { 
  useToolRenderer, 
  ToolRendererProps,
  limitLines,
  parseBasicToolResult 
} from './useToolRenderer.js';

// Helper function to parse search results
function parseSearchResults(output: string): { files: number; matches: number; isEmpty: boolean } {
  if (output === 'No matches found') {
    return { files: 0, matches: 0, isEmpty: true };
  }

  // Parse "Found X match(es)" pattern
  const matchPattern = /Found (\d+) match(?:es)?/;
  const match = output.match(matchPattern);
  const totalMatches = match ? parseInt(match[1], 10) : 0;

  // Count unique files by counting lines that don't start with whitespace and contain ":"
  const lines = output.split('\n');
  const fileLines = lines.filter(line => 
    line.trim().length > 0 && 
    !line.startsWith(' ') && 
    !line.startsWith('\t') &&
    line.includes(':') &&
    !line.startsWith('Found')
  );
  
  return { 
    files: fileLines.length, 
    matches: totalMatches, 
    isEmpty: totalMatches === 0 
  };
}

// Helper function to get search parameters summary
function getSearchParameters(input: Record<string, unknown>): string {
  const parts: string[] = [];
  
  if (input.caseSensitive) parts.push('case-sensitive');
  if (input.wholeWord) parts.push('whole words');
  if (input.includePattern) parts.push(`include: ${input.includePattern}`);
  if (input.excludePattern) parts.push(`exclude: ${input.excludePattern}`);
  if (input.contextLines && input.contextLines !== 0) parts.push(`context: ${input.contextLines}`);
  
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

// Helper function to get search path display
function getSearchPath(input: Record<string, unknown>): string {
  const path = input.path as string;
  if (!path || path === '.') {
    return 'current directory';
  }
  return path;
}

export function FileSearchToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: ToolRendererProps) {
  
  const { timelineEntry } = useToolRenderer(
    item,
    {
      toolName: 'Search',
      streamingAction: 'searching...',
      
      getPrimaryInfo: (input) => {
        const pattern = (input.pattern as string) || '';
        const searchPath = getSearchPath(input);
        return `"${pattern}" in ${searchPath}`;
      },
      
      getSecondaryInfo: (input) => getSearchParameters(input),
      
      parseOutput: (result, input) => {
        const { success, output } = parseBasicToolResult(result);
        
        if (!success) {
          return {
            success: false,
            errorMessage: output || 'Unknown error'
          };
        }

        const searchStats = parseSearchResults(output);
        
        // Create stats summary
        const statsText = searchStats.isEmpty 
          ? 'No matches found'
          : `${searchStats.matches} matches across ${searchStats.files} files`;

        // Create preview content for collapsed view
        const previewContent = searchStats.isEmpty ? (
          <Text color="gray">No matches found</Text>
        ) : (
          <Box flexDirection="column">
            {/* Show first few lines of results as preview */}
            {(() => {
              const { lines, truncated } = limitLines(output, 4);
              // Skip the "Found X matches" header line
              const previewLines = lines.filter(line => !line.startsWith('Found'));
              const displayLines = previewLines.slice(0, 3);
              
              return (
                <Box flexDirection="column">
                  {displayLines.map((line, index) => (
                    <Text key={index} color="gray">
                      {line}
                    </Text>
                  ))}
                  {(truncated || previewLines.length > 3) && (
                    <Text color="gray">... and more</Text>
                  )}
                </Box>
              );
            })()}
          </Box>
        );

        // Create main content for expanded view
        const mainContent = searchStats.isEmpty ? null : <Text>{output}</Text>;

        return {
          success,
          isEmpty: searchStats.isEmpty,
          stats: statsText,
          previewContent,
          mainContent
        };
      }
    },
    isStreaming,
    isSelected,
    onToggle
  );

  return timelineEntry;
}