// ABOUTME: Specialized renderer for file-edit tool executions using three-layer architecture
// ABOUTME: Shows file edit operations with replacement details and line counts

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
  
  return (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Edit Parameters:</Text>
        <Box marginLeft={2}>
          <Text color="cyan">File: </Text>
          <Text>{input.path as string}</Text>
        </Box>
        <Box marginLeft={2} marginTop={1}>
          <Text color="red">- Removed ({oldText.split('\n').length} lines):</Text>
          <Box marginLeft={2}>
            {(() => {
              const { lines } = limitLines(oldText, 10);
              return lines.map((line, index) => (
                <Text key={`old-${index}`} color="red">
                  - {line}
                </Text>
              ));
            })()}
          </Box>
        </Box>
        <Box marginLeft={2} marginTop={1}>
          <Text color="green">+ Added ({newText.split('\n').length} lines):</Text>
          <Box marginLeft={2}>
            {(() => {
              const { lines } = limitLines(newText, 10);
              return lines.map((line, index) => (
                <Text key={`new-${index}`} color="green">
                  + {line}
                </Text>
              ));
            })()}
          </Box>
        </Box>
      </Box>

      {/* Output */}
      <Box flexDirection="column">
        <Text color={success ? 'green' : 'red'}>
          {success ? 'Result:' : 'Error:'}
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

export const FileEditToolRenderer = forwardRef<TimelineItemRef, FileEditToolRendererProps>(({
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
      // Edit doesn't need special focus handling
    },
  }), []);

  // Layer 3: Display with custom components
  const oldText = (toolData.input.old_text as string) || '';
  
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: !toolData.isStreaming && oldText ? (
          <EditPreview oldText={oldText} />
        ) : undefined,
        content: (
          <EditContent
            input={toolData.input}
            output={toolData.output}
            success={toolData.success}
          />
        ),
      }}
    />
  );
});