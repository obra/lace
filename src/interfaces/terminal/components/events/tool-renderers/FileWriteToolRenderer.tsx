// ABOUTME: Specialized renderer for file-write tool executions using three-layer architecture
// ABOUTME: Shows file write operations with character counts and content preview

import React from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData, type ToolExecutionItem } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { limitLines } from './useToolRenderer.js';

interface FileWriteToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Custom preview component for file write
function WritePreview({ content }: { content: string }) {
  const { lines, truncated } = limitLines(content, 2);
  
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index} color="gray">
          {line}
        </Text>
      ))}
      {truncated && <Text color="gray">... and more</Text>}
    </Box>
  );
}

// Custom content component for file write
function WriteContent({ content }: { content: string }) {
  const { lines, truncated, remaining } = limitLines(content, 5);
  
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
      {truncated && (
        <Text color="gray">... ({remaining} more lines)</Text>
      )}
    </Box>
  );
}

export function FileWriteToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: FileWriteToolRendererProps) {
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management
  const toolState = useToolState(isSelected, onToggle);
  
  // Get content from input
  const content = (toolData.input.content as string) || '';
  
  // Layer 3: Display with custom components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: toolData.result && !toolData.isStreaming ? (
          <WritePreview content={content} />
        ) : undefined,
        content: <WriteContent content={content} />
      }}
    />
  );
}