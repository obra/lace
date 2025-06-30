// ABOUTME: Specialized renderer for file-write tool executions with path and content summary
// ABOUTME: Shows file write operations with character counts and content preview

import React from 'react';
import { Box, Text } from 'ink';
import { 
  useToolRenderer, 
  ToolRendererProps,
  limitLines,
  parseBasicToolResult 
} from './useToolRenderer.js';

// Helper function to parse write result
function parseWriteResult(output: string): { characterCount: number; filePath: string } | null {
  // Parse "Successfully wrote X characters to path"
  const pattern = /Successfully wrote (\d+) characters to (.+)/;
  const match = output.match(pattern);
  
  if (match) {
    return {
      characterCount: parseInt(match[1], 10),
      filePath: match[2]
    };
  }
  
  return null;
}

// Helper function to format character count
function formatCharacterCount(count: number): string {
  if (count === 0) return '0 characters';
  if (count === 1) return '1 character';
  
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M characters`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K characters`;
  }
  
  return `${count} characters`;
}

export function FileWriteToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: ToolRendererProps) {
  
  const { timelineEntry } = useToolRenderer(
    item,
    {
      toolName: 'Write',
      streamingAction: 'writing...',
      
      getPrimaryInfo: (input) => (input.path as string) || '',
      
      parseOutput: (result, input) => {
        const { success, output } = parseBasicToolResult(result);
        
        if (!success) {
          return {
            success: false,
            errorMessage: output || 'Unknown error'
          };
        }

        const writeResult = parseWriteResult(output);
        const content = (input.content as string) || '';
        
        if (!writeResult) {
          return {
            success: false,
            errorMessage: 'Could not parse write result'
          };
        }

        // Create stats summary
        const statsText = formatCharacterCount(writeResult.characterCount);

        // Create preview content for collapsed view
        const previewContent = (
          <Box flexDirection="column">
            {(() => {
              const { lines, truncated } = limitLines(content, 2);
              return (
                <Box flexDirection="column">
                  {lines.map((line, index) => (
                    <Text key={index} color="gray">
                      {line}
                    </Text>
                  ))}
                  {truncated && (
                    <Text color="gray">... and more</Text>
                  )}
                </Box>
              );
            })()}
          </Box>
        );

        // Create main content for expanded view
        const mainContent = (
          <Box flexDirection="column">
            {(() => {
              const { lines, truncated, remaining } = limitLines(content, 5);
              return (
                <Box flexDirection="column">
                  {lines.map((line, index) => (
                    <Text key={index}>
                      {line}
                    </Text>
                  ))}
                  {truncated && (
                    <Text color="gray">... ({remaining} more lines)</Text>
                  )}
                </Box>
              );
            })()}
          </Box>
        );

        return {
          success,
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