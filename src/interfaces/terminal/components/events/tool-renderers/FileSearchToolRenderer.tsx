// ABOUTME: Specialized renderer for ripgrep-search tool executions using three-layer architecture
// ABOUTME: Shows search results grouped by file with line numbers and highlighted matches

import React from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData, type ToolExecutionItem } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { limitLines } from './useToolRenderer.js';

interface FileSearchToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Custom preview component for search results
function SearchPreview({ output, isEmpty }: { output: string; isEmpty?: boolean }) {
  if (isEmpty) {
    return <Text color="gray">No matches found</Text>;
  }
  
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
}

// Custom content component for search results
function SearchContent({ output, isEmpty }: { output: string; isEmpty?: boolean }) {
  if (isEmpty) {
    return <Text color="gray">No matches found</Text>;
  }
  
  return <Text>{output}</Text>;
}

export function FileSearchToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: FileSearchToolRendererProps) {
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management
  const toolState = useToolState(isSelected, onToggle);
  
  // Layer 3: Display with custom components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: toolData.result && !toolData.isStreaming ? (
          <SearchPreview output={toolData.output} isEmpty={toolData.isEmpty} />
        ) : undefined,
        content: (
          <SearchContent output={toolData.output} isEmpty={toolData.isEmpty} />
        )
      }}
    />
  );
}