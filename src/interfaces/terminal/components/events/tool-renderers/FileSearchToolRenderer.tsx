// ABOUTME: Renderer for ripgrep-search tool executions with direct component composition
// ABOUTME: Shows search results grouped by file with line numbers and highlighted matches

import React from 'react';
import { Box, Text } from 'ink';
import { ToolHeader, ToolPreview, ToolContent, useToolExpansion, limitLines, type ToolRendererProps } from './components/shared.js';

// Extract match count from search results
function extractMatchCount(output: string): string | null {
  const matchLine = output.split('\n')[0];
  const matchRegex = /Found (\d+) match(?:es)? in (\d+) files?:/;
  const match = matchLine.match(matchRegex);
  
  if (match) {
    const [, matches, files] = match;
    const matchText = matches === '1' ? 'match' : 'matches';
    const fileText = files === '1' ? 'file' : 'files';
    return `${matches} ${matchText} in ${files} ${fileText}`;
  }
  return null;
}

export function FileSearchToolRenderer({ item, isSelected = false, onToggle }: ToolRendererProps) {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly
  const { pattern, path } = item.call.arguments as { pattern: string; path: string };
  const output = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Check for empty results
  const isEmpty = output === 'No matches found';
  
  // Extract match stats
  const matchStats = !isEmpty && output ? extractMatchCount(output) : null;
  
  return (
    <Box flexDirection="column">
      <ToolHeader icon="🔍" status={status}>
        <Text bold>ripgrep-search</Text>
        <Text> "{pattern}"</Text>
        <Text color="gray"> in {path}</Text>
        {matchStats && (
          <React.Fragment>
            <Text color="gray"> - </Text>
            <Text color="cyan">{matchStats}</Text>
          </React.Fragment>
        )}
      </ToolHeader>
      
      {!isExpanded && output && item.result && !isRunning && (
        <ToolPreview>
          {isEmpty ? (
            <Text color="gray">No matches found</Text>
          ) : (
            (() => {
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
            })()
          )}
        </ToolPreview>
      )}
      
      {isExpanded && (
        <ToolContent>
          {isEmpty ? (
            <Text color="gray">No matches found</Text>
          ) : (
            <Text>{output}</Text>
          )}
        </ToolContent>
      )}
    </Box>
  );
}