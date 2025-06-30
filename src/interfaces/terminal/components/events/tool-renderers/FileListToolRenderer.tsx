// ABOUTME: Specialized renderer for file-list tool executions with tree structure display
// ABOUTME: Shows directory trees with proper indentation, file sizes, and type indicators

import React from 'react';
import { Box, Text } from 'ink';
import { 
  useToolRenderer, 
  ToolRendererProps,
  limitLines,
  parseBasicToolResult 
} from './useToolRenderer.js';

// Helper function to count tree elements for summary
function countTreeElements(text: string): { files: number; dirs: number; lines: number } {
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
  
  return { files, dirs, lines: lines.length };
}

// Helper function to extract directory path from arguments
function getDirectoryPath(input: Record<string, unknown>): string {
  const path = input.path as string;
  if (!path || path === '.') {
    return 'current directory';
  }
  return path;
}

// Helper function to create parameter summary
function getParameterSummary(input: Record<string, unknown>): string {
  const parts: string[] = [];
  
  if (input.recursive) parts.push('recursive');
  if (input.includeHidden) parts.push('hidden files');
  if (input.pattern) parts.push(`pattern: ${input.pattern}`);
  if (input.maxDepth && input.maxDepth !== 3) parts.push(`depth: ${input.maxDepth}`);
  
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function FileListToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: ToolRendererProps) {
  
  const { timelineEntry } = useToolRenderer(
    item,
    {
      toolName: 'File List',
      streamingAction: 'scanning...',
      
      getPrimaryInfo: (input) => getDirectoryPath(input),
      getSecondaryInfo: (input) => getParameterSummary(input),
      
      parseOutput: (result, input) => {
        const { success, output } = parseBasicToolResult(result);
        
        if (!success) {
          return {
            success: false,
            errorMessage: output || 'Unknown error'
          };
        }

        const isEmpty = output === 'No files found';
        const stats = isEmpty ? { files: 0, dirs: 0, lines: 0 } : countTreeElements(output);
        
        // Create stats summary
        const statsText = `${stats.files} files, ${stats.dirs} directories`;

        // Create preview content for collapsed view
        const previewContent = isEmpty ? (
          <Text color="gray">No files found</Text>
        ) : (
          <Box flexDirection="column">
            {/* Show first few lines of tree as preview */}
            {(() => {
              const { lines, truncated, remaining } = limitLines(output, 3);
              return (
                <Box flexDirection="column">
                  {lines.map((line, index) => (
                    <Text key={index} color="gray">
                      {line}
                    </Text>
                  ))}
                  {truncated && (
                    <Text color="gray">... and {remaining} more lines</Text>
                  )}
                </Box>
              );
            })()}
          </Box>
        );

        // Create main content for expanded view
        const mainContent = isEmpty ? null : <Text>{output}</Text>;

        return {
          success,
          isEmpty,
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