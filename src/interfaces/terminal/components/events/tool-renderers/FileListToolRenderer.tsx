// ABOUTME: Specialized renderer for file-list tool executions using three-layer architecture
// ABOUTME: Shows directory trees with proper indentation, file sizes, and type indicators

import React from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData, type ToolExecutionItem } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { limitLines } from './useToolRenderer.js';

interface FileListToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

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

// Custom preview component for file lists
function FileListPreview({ output }: { output: string }) {
  if (output === 'No files found') {
    return <Text color="gray">No files found</Text>;
  }
  
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
}

// Custom content component for file lists
function FileListContent({ output, isEmpty }: { output: string; isEmpty?: boolean }) {
  if (isEmpty) {
    return <Text color="gray">No files found</Text>;
  }
  
  return <Text>{output}</Text>;
}

export function FileListToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: FileListToolRendererProps) {
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management
  const toolState = useToolState(isSelected, onToggle);
  
  // Add file-specific stats to toolData
  if (toolData.result && toolData.success && !toolData.stats) {
    const isEmpty = toolData.output === 'No files found';
    if (!isEmpty) {
      const stats = countTreeElements(toolData.output);
      toolData.stats = `${stats.files} files, ${stats.dirs} directories`;
    }
    toolData.isEmpty = isEmpty;
  }
  
  // Layer 3: Display with custom components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: <FileListPreview output={toolData.output} />,
        content: <FileListContent output={toolData.output} isEmpty={toolData.isEmpty} />
      }}
    />
  );
}