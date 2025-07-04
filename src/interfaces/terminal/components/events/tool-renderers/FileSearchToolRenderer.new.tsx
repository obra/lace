// ABOUTME: Specialized renderer for ripgrep-search tool executions using three-layer architecture  
// ABOUTME: Shows search results grouped by file with line numbers and highlighted matches

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
function SearchContent({ 
  input, 
  output, 
  success,
  isEmpty 
}: { 
  input: Record<string, unknown>; 
  output: string; 
  success: boolean;
  isEmpty?: boolean;
}) {
  return (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Search Parameters:</Text>
        <Box marginLeft={2}>
          <Text color="cyan">Pattern: </Text>
          <Text>"{input.pattern as string}"</Text>
        </Box>
        <Box marginLeft={2}>
          <Text color="cyan">Path: </Text>
          <Text>{(input.path as string) || 'current directory'}</Text>
        </Box>
        {input.caseSensitive && (
          <Box marginLeft={2}>
            <Text color="cyan">Case-sensitive: </Text>
            <Text>Yes</Text>
          </Box>
        )}
        {input.wholeWord && (
          <Box marginLeft={2}>
            <Text color="cyan">Whole words only: </Text>
            <Text>Yes</Text>
          </Box>
        )}
        {input.includePattern && (
          <Box marginLeft={2}>
            <Text color="cyan">Include pattern: </Text>
            <Text>{input.includePattern as string}</Text>
          </Box>
        )}
        {input.excludePattern && (
          <Box marginLeft={2}>
            <Text color="cyan">Exclude pattern: </Text>
            <Text>{input.excludePattern as string}</Text>
          </Box>
        )}
        {input.contextLines && input.contextLines !== 0 && (
          <Box marginLeft={2}>
            <Text color="cyan">Context lines: </Text>
            <Text>{input.contextLines as number}</Text>
          </Box>
        )}
      </Box>

      {/* Results */}
      <Box flexDirection="column">
        <Text color={success ? 'green' : 'red'}>
          {success ? 'Results:' : 'Error:'}
        </Text>
        <Box marginLeft={2}>
          {success ? (
            isEmpty ? (
              <Text color="gray">No matches found</Text>
            ) : (
              <Text>{output}</Text>
            )
          ) : (
            <Text color="red">{output || 'Unknown error'}</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export const FileSearchToolRenderer = forwardRef<TimelineItemRef, FileSearchToolRendererProps>(({
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
      // Search doesn't need special focus handling
    },
  }), []);

  // Layer 3: Display with custom components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: !toolData.isStreaming ? (
          <SearchPreview 
            output={toolData.output} 
            isEmpty={toolData.isEmpty}
          />
        ) : undefined,
        content: (
          <SearchContent
            input={toolData.input}
            output={toolData.output}
            success={toolData.success}
            isEmpty={toolData.isEmpty}
          />
        ),
      }}
    />
  );
});