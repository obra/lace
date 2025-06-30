// ABOUTME: Specialized renderer for file-edit tool executions with replacement details and line counts
// ABOUTME: Shows file edit operations with before/after line counts and replacement context

import React from 'react';
import { Box, Text } from 'ink';
import { 
  useToolRenderer, 
  ToolRendererProps,
  limitLines,
  parseBasicToolResult 
} from './useToolRenderer.js';

// Helper function to parse edit result
function parseEditResult(output: string): { filePath: string; fromLines: number; toLines: number } | null {
  // Parse "Successfully replaced text in path (X lines → Y lines)"
  const pattern = /Successfully replaced text in (.+) \((\d+) lines → (\d+) lines\)/;
  const match = output.match(pattern);
  
  if (match) {
    return {
      filePath: match[1],
      fromLines: parseInt(match[2], 10),
      toLines: parseInt(match[3], 10)
    };
  }
  
  return null;
}

export function FileEditToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: ToolRendererProps) {
  
  const { timelineEntry } = useToolRenderer(
    item,
    {
      toolName: 'Edit',
      streamingAction: 'editing...',
      
      getPrimaryInfo: (input) => (input.path as string) || '',
      
      parseOutput: (result, input) => {
        const { success, output } = parseBasicToolResult(result);
        
        if (!success) {
          return {
            success: false,
            errorMessage: output || 'Unknown error'
          };
        }

        const editResult = parseEditResult(output);
        const oldText = (input.old_text as string) || '';
        const newText = (input.new_text as string) || '';
        
        if (!editResult) {
          return {
            success: false,
            errorMessage: 'Could not parse edit result'
          };
        }

        // Create stats summary
        const statsText = `1 replacement (${editResult.fromLines} → ${editResult.toLines} lines)`;

        // Create preview content for collapsed view
        const previewContent = (
          <Box flexDirection="column">
            {(() => {
              const { lines, truncated } = limitLines(oldText, 2);
              return (
                <Box flexDirection="column">
                  {lines.map((line, index) => (
                    <Text key={index} color="red">
                      - {line}
                    </Text>
                  ))}
                  {truncated && <Text color="gray">... and more</Text>}
                </Box>
              );
            })()}
          </Box>
        );

        // Create main content for expanded view
        const mainContent = (
          <Box flexDirection="column" marginTop={1}>
            <Text color="red">- Removed:</Text>
            {(() => {
              const { lines } = limitLines(oldText, 10);
              return lines.map((line, index) => (
                <Text key={`old-${index}`} color="red">
                  - {line}
                </Text>
              ));
            })()}
            
            <Text color="green">+ Added:</Text>
            {(() => {
              const { lines } = limitLines(newText, 10);
              return lines.map((line, index) => (
                <Text key={`new-${index}`} color="green">
                  + {line}
                </Text>
              ));
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