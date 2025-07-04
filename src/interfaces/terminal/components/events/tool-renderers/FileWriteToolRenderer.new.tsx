// ABOUTME: Specialized renderer for file-write tool executions using three-layer architecture
// ABOUTME: Shows file write operations with character counts and content preview

import React, { forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { TimelineItemRef } from '../../timeline-item-focus.js';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { limitLines } from './useToolRenderer.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: any;
  result?: any;
  timestamp: Date;
  callId: string;
};

interface FileWriteToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Custom preview component for file write
function FileWritePreview({ content }: { content: string }) {
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
}

// Custom content component for file write
function FileWriteContent({ 
  input, 
  output, 
  success 
}: { 
  input: Record<string, unknown>; 
  output: string; 
  success: boolean; 
}) {
  const content = (input.content as string) || '';
  
  return (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <Text color="cyan">Path: </Text>
          <Text>{input.path as string}</Text>
        </Box>
        <Box marginLeft={2} marginTop={1}>
          <Text color="cyan">Content ({(content || '').length} characters):</Text>
          <Box marginLeft={2} marginTop={1}>
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
        </Box>
      </Box>

      {/* Output */}
      <Box flexDirection="column">
        <Text color={success ? 'green' : 'red'}>
          {success ? 'Output:' : 'Error:'}
        </Text>
        <Box marginLeft={2}>
          <Text color={success ? 'green' : 'red'}>
            {output || 'No output'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export const FileWriteToolRenderer = forwardRef<TimelineItemRef, FileWriteToolRendererProps>(({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}, ref) => {
  
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management  
  const toolState = useToolState(toolData, isSelected, onToggle);
  
  // Expose ref methods (compatibility)
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      // File write doesn't need special focus handling
    },
  }), []);

  // Layer 3: Display with custom components
  const content = (toolData.input.content as string) || '';
  
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: !toolData.isStreaming && content ? (
          <FileWritePreview content={content} />
        ) : undefined,
        content: (
          <FileWriteContent
            input={toolData.input}
            output={toolData.output}
            success={toolData.success}
          />
        ),
      }}
    />
  );
});