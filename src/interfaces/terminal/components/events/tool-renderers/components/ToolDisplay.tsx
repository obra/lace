// ABOUTME: Composable display component for tool renderers with three-layer architecture integration
// ABOUTME: Provides default header/preview/content patterns with custom component override support

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, type TimelineStatus } from '../../../ui/TimelineEntry.js';
import { CompactOutput } from '../../../ui/CompactOutput.js';
import { CodeDisplay } from '../../../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../../theme.js';
import { ToolData } from '../hooks/useToolData.js';
import { ToolState } from '../hooks/useToolState.js';

// Component customization interface
export interface ToolDisplayComponents {
  header?: React.ReactNode;
  preview?: React.ReactNode;
  content?: React.ReactNode;
}

// Main component props
export interface ToolDisplayProps {
  toolData: ToolData;
  toolState: ToolState;
  isSelected: boolean;
  onToggle?: () => void;
  components?: ToolDisplayComponents;
}

// Default header component
function DefaultHeader({ 
  toolData, 
  isStreaming 
}: { 
  toolData: ToolData; 
  isStreaming?: boolean; 
}) {
  return (
    <Box>
      <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
      <Text color={UI_COLORS.TOOL} bold>
        {toolData.toolName}
      </Text>
      <Text color="gray">: </Text>
      <Text color="white">{toolData.primaryInfo}</Text>
      {toolData.secondaryInfo && (
        <Text color="gray">{toolData.secondaryInfo}</Text>
      )}
      <Text color="gray"> </Text>
      <Text color={toolData.success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {toolData.statusIcon}
      </Text>
      {isStreaming && <Text color="gray"> (running...)</Text>}
      {toolData.stats && (
        <>
          <Text color="gray"> - </Text>
          <Text color="cyan">{toolData.stats}</Text>
        </>
      )}
    </Box>
  );
}

// Default preview component (shown when collapsed and has output)
function DefaultPreview({ toolData }: { toolData: ToolData }) {
  if (toolData.isStreaming || !toolData.output) {
    return null;
  }

  return (
    <Box marginLeft={2} marginTop={1}>
      <CompactOutput
        output={toolData.output}
        language={toolData.language}
        maxLines={3}
        canExpand={false}
      />
    </Box>
  );
}

// Default content component (shown when expanded)
function DefaultContent({ toolData }: { toolData: ToolData }) {
  return (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <CodeDisplay 
            code={JSON.stringify(toolData.input, null, 2)} 
            language="json" 
            compact={false} 
          />
        </Box>
      </Box>

      {/* Output or Error */}
      {toolData.result && (
        <Box flexDirection="column">
          <Text color={toolData.success ? 'green' : 'red'}>
            {toolData.success ? 'Output:' : 'Error:'}
          </Text>
          <Box marginLeft={2}>
            {toolData.success ? (
              <CompactOutput
                output={toolData.output || 'No output'}
                language={toolData.language}
                maxLines={50}
                canExpand={false}
              />
            ) : (
              <Text color="red">{toolData.output || 'Unknown error'}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Main ToolDisplay component
export function ToolDisplay({
  toolData,
  toolState,
  isSelected,
  onToggle,
  components = {},
}: ToolDisplayProps) {
  // Determine status for TimelineEntry
  const markerStatus: TimelineStatus = toolData.isStreaming 
    ? 'pending' 
    : toolData.success 
    ? 'success' 
    : toolData.result 
    ? 'error' 
    : 'none';

  // Build summary (header + preview)
  const summary = (
    <Box flexDirection="column">
      {/* Header */}
      {components.header || (
        <DefaultHeader 
          toolData={toolData} 
          isStreaming={toolData.isStreaming} 
        />
      )}
      
      {/* Preview (only when collapsed and not streaming) */}
      {!toolState.isExpanded && !toolData.isStreaming && (
        components.preview || <DefaultPreview toolData={toolData} />
      )}
    </Box>
  );

  // Build content (shown when expanded)
  const content = components.content || <DefaultContent toolData={toolData} />;

  return (
    <TimelineEntry
      label={`${toolData.toolName} "${toolData.primaryInfo}"`}
      summary={summary}
      isExpanded={toolState.isExpanded}
      onExpandedChange={toolState.handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status={markerStatus}
      isExpandable={true}
    >
      {content}
    </TimelineEntry>
  );
}