// ABOUTME: Renderer for file-edit tool executions with direct component composition
// ABOUTME: Shows file edit operations with before/after line counts and replacement context

import React from 'react';
import { Box, Text } from 'ink';
import { ToolHeader, ToolPreview, ToolContent, useToolExpansion, limitLines, type ToolRendererProps } from './components/shared.js';

export function FileEditToolRenderer({ item, isSelected = false, onToggle }: ToolRendererProps) {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly
  const { file_path, old_text, new_text } = item.call.arguments as { 
    file_path: string; 
    old_text: string; 
    new_text: string; 
  };
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Calculate line counts
  const oldLineCount = old_text ? old_text.split('\n').length : 0;
  const newLineCount = new_text ? new_text.split('\n').length : 0;
  
  return (
    <Box flexDirection="column">
      <ToolHeader icon="✏️" status={status}>
        <Text bold>file-edit</Text>
        <Text> {file_path}</Text>
        <Text color="gray"> - </Text>
        <Text color="cyan">-{oldLineCount} +{newLineCount} lines</Text>
      </ToolHeader>
      
      {!isExpanded && old_text && item.result && !isRunning && (
        <ToolPreview>
          {(() => {
            const { lines, truncated } = limitLines(old_text, 2);
            return (
              <Box flexDirection="column">
                {lines.map((line, index) => (
                  <Text key={index} color="red">- {line}</Text>
                ))}
                {truncated && <Text color="gray">... and more</Text>}
              </Box>
            );
          })()}
        </ToolPreview>
      )}
      
      {isExpanded && (
        <ToolContent>
          {hasError && item.result ? (
            <Box flexDirection="column">
              <Text color="red">Error:</Text>
              <Box marginLeft={2}>
                <Text color="red">{item.result.content?.[0]?.text || 'Unknown error'}</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color="red">- Removed:</Text>
              {(() => {
                const { lines } = limitLines(old_text, 10);
                return lines.map((line, index) => (
                  <Text key={`old-${index}`} color="red">
                    - {line}
                  </Text>
                ));
              })()}
              
              <Box marginTop={1}>
                <Text color="green">+ Added:</Text>
              </Box>
              {(() => {
                const { lines } = limitLines(new_text, 10);
                return lines.map((line, index) => (
                  <Text key={`new-${index}`} color="green">
                    + {line}
                  </Text>
                ));
              })()}
            </Box>
          )}
        </ToolContent>
      )}
    </Box>
  );
}