// ABOUTME: Specialized renderer for file-edit tool executions using three-layer architecture
// ABOUTME: Shows file edit operations with before/after line counts and replacement context

import React from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData, type ToolExecutionItem } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { limitLines } from './useToolRenderer.js';

interface FileEditToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Custom preview component for edit operations
function EditPreview({ oldText }: { oldText: string }) {
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
}

// Custom content component for edit operations
function EditContent({ 
  input, 
  output, 
  success 
}: { 
  input: Record<string, unknown>; 
  output: string; 
  success: boolean;
}) {
  const oldText = (input.old_text as string) || '';
  const newText = (input.new_text as string) || '';
  
  if (!success) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error:</Text>
        <Box marginLeft={2}>
          <Text color="red">{output || 'Unknown error'}</Text>
        </Box>
      </Box>
    );
  }
  
  return (
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
      
      <Box marginTop={1}>
        <Text color="green">+ Added:</Text>
      </Box>
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
}

export function FileEditToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: FileEditToolRendererProps) {
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management
  const toolState = useToolState(isSelected, onToggle);
  
  // Get old text for preview
  const oldText = (toolData.input.old_text as string) || '';
  
  // Layer 3: Display with custom components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: toolData.result && !toolData.isStreaming ? (
          <EditPreview oldText={oldText} />
        ) : undefined,
        content: (
          <EditContent 
            input={toolData.input} 
            output={toolData.output} 
            success={toolData.success} 
          />
        )
      }}
    />
  );
}