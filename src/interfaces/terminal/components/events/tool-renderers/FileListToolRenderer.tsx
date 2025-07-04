// ABOUTME: Renderer for file-list tool executions with direct component composition
// ABOUTME: Shows directory trees with proper indentation, file sizes, and type indicators

import React from 'react';
import { Box, Text } from 'ink';
import { ToolHeader, ToolPreview, ToolContent, useToolExpansion, limitLines, type ToolRendererProps } from './components/shared.js';

// Helper function to count tree elements
function countTreeElements(text: string): { files: number; dirs: number } {
  const lines = text.split('\n');
  let files = 0;
  let dirs = 0;
  
  for (const line of lines) {
    if (line.includes('(') && line.includes('bytes)')) {
      files++;
    } else if (line.includes('/') && !line.includes('bytes)')) {
      dirs++;
    }
  }
  
  return { files, dirs };
}

export function FileListToolRenderer({ item, isSelected = false, onToggle }: ToolRendererProps) {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly
  const { path, recursive } = item.call.arguments as { path: string; recursive?: boolean };
  const output = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Calculate stats
  const isEmpty = output === 'No files found';
  let stats = '';
  if (item.result && !hasError && !isEmpty && output) {
    const counts = countTreeElements(output);
    stats = `${counts.files} files, ${counts.dirs} directories`;
  }
  
  return (
    <Box flexDirection="column">
      <ToolHeader icon="📁" status={status}>
        <Text bold>file-list</Text>
        <Text> {path || 'current directory'}</Text>
        {recursive && <Text color="gray"> (recursive)</Text>}
        {stats && (
          <>
            <Text color="gray"> - </Text>
            <Text color="cyan">{stats}</Text>
          </>
        )}
      </ToolHeader>
      
      {!isExpanded && output && item.result && !isRunning && (
        <ToolPreview>
          {isEmpty ? (
            <Text color="gray">No files found</Text>
          ) : (
            (() => {
              const { lines, truncated, remaining } = limitLines(output, 3);
              return (
                <Box flexDirection="column">
                  {lines.map((line, index) => (
                    <Text key={index} color="gray">{line}</Text>
                  ))}
                  {truncated && (
                    <Text color="gray">... and {remaining} more lines</Text>
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
            <Text color="gray">No files found</Text>
          ) : (
            <Text>{output}</Text>
          )}
        </ToolContent>
      )}
    </Box>
  );
}