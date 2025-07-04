// ABOUTME: Generic tool renderer using three-layer architecture for unknown/unsupported tools
// ABOUTME: Provides fallback display for any tool execution with input/output visualization

import React, { forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData, type ToolExecutionItem } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { TimelineItemRef } from '../../timeline-item-focus.js';

interface GenericToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Custom header component that adds [GENERIC] tag
function GenericHeader({ toolData }: { toolData: any }) {
  return (
    <Box>
      <Text color="magenta">🔧 </Text>
      <Text color="magenta" bold>
        {toolData.toolName}
      </Text>
      <Text color="gray">: </Text>
      <Text color="white">{toolData.primaryInfo || 'unknown'}</Text>
      {toolData.secondaryInfo && (
        <Text color="gray">{toolData.secondaryInfo}</Text>
      )}
      <Text color="gray"> </Text>
      <Text color={toolData.success ? 'green' : 'red'}>
        {toolData.statusIcon}
      </Text>
      {toolData.isStreaming && <Text color="gray"> (running...)</Text>}
      <Text color="magenta"> [GENERIC]</Text>
    </Box>
  );
}

export const GenericToolRenderer = forwardRef<TimelineItemRef, GenericToolRendererProps>(({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}, ref) => {
  // Generic tool renderer doesn't support focus entry
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      // No-op for generic tool renderer
    },
  }), []);
  
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management
  const toolState = useToolState(isSelected, onToggle);
  
  // Layer 3: Display with custom header
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        header: <GenericHeader toolData={toolData} />
      }}
    />
  );
});