// ABOUTME: Renderer for file-write tool executions with direct component composition
// ABOUTME: Shows file write operations with character counts and content preview

import React from 'react';
import { Box, Text } from 'ink';
import { ToolHeader, ToolPreview, ToolContent, useToolExpansion, limitLines, type ToolRendererProps } from './components/shared.js';

export function FileWriteToolRenderer({ item, isSelected = false, onToggle }: ToolRendererProps) {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly
  const { file_path, content } = item.call.arguments as { file_path: string; content: string };
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Calculate character count
  const charCount = content ? content.length : 0;
  
  return (
    <Box flexDirection="column">
      <ToolHeader icon="📝" status={status}>
        <Text bold>file-write</Text>
        <Text> {file_path}</Text>
        <Text color="gray"> - </Text>
        <Text color="cyan">{charCount} chars</Text>
      </ToolHeader>
      
      {!isExpanded && content && item.result && !isRunning && (
        <ToolPreview>
          {(() => {
            const { lines, truncated } = limitLines(content, 2);
            return (
              <Box flexDirection="column">
                {lines.map((line, index) => (
                  <Text key={index}>{line}</Text>
                ))}
                {truncated && <Text color="gray">... and more</Text>}
              </Box>
            );
          })()}
        </ToolPreview>
      )}
      
      {isExpanded && (
        <ToolContent>
          <Box flexDirection="column">
            {content && (
              <>
                {(() => {
                  const { lines, truncated, remaining } = limitLines(content, 5);
                  return (
                    <>
                      {lines.map((line, index) => (
                        <Text key={index}>{line}</Text>
                      ))}
                      {truncated && (
                        <Text color="gray">... ({remaining} more lines)</Text>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </Box>
        </ToolContent>
      )}
    </Box>
  );
}