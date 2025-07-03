// ABOUTME: Composable tool display component with clean separation of header, preview, and content
// ABOUTME: Provides consistent UI patterns while allowing tool-specific customization through component composition

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { UI_COLORS } from '../../../theme.js';
import { ToolData } from '../hooks/useToolData.js';
import { ToolState } from '../hooks/useToolState.js';

// Component composition interface for tool-specific sections
export interface ToolDisplayComponents {
  // Header section (displays tool name and primary info)
  header?: React.ComponentType<{ toolData: ToolData }>;
  
  // Preview section (collapsed state summary)
  preview?: React.ComponentType<{ toolData: ToolData; toolState: ToolState }>;
  
  // Content section (expanded state details)
  content?: React.ComponentType<{ toolData: ToolData; toolState: ToolState }>;
}

// Props for the main ToolDisplay component
export interface ToolDisplayProps {
  toolData: ToolData;
  toolState: ToolState;
  isSelected: boolean;
  components?: ToolDisplayComponents;
  children?: React.ReactNode; // For custom content
}

/**
 * Main tool display component with composable sections
 * 
 * This component provides the standard timeline entry structure while allowing
 * tool-specific customization through component composition. Tools can provide
 * custom header, preview, and content components, or use the default implementations.
 */
export function ToolDisplay({ 
  toolData, 
  toolState, 
  isSelected, 
  components = {},
  children 
}: ToolDisplayProps) {
  
  const { header: HeaderComponent, preview: PreviewComponent, content: ContentComponent } = components;
  
  // Use custom header or default
  const header = HeaderComponent ? (
    <HeaderComponent toolData={toolData} />
  ) : (
    <DefaultToolHeader toolData={toolData} />
  );
  
  // Use custom preview or default
  const preview = PreviewComponent ? (
    <PreviewComponent toolData={toolData} toolState={toolState} />
  ) : (
    <DefaultToolPreview toolData={toolData} />
  );
  
  // Use custom content, children, or default
  const content = children || (ContentComponent ? (
    <ContentComponent toolData={toolData} toolState={toolState} />
  ) : (
    <DefaultToolContent toolData={toolData} />
  ));

  return (
    <TimelineEntryCollapsibleBox
      label={header}
      summary={toolData.success && preview}
      isExpanded={toolState.isExpanded}
      onExpandedChange={toolState.handleExpandedChange}
      isSelected={isSelected}
      status={toolData.markerStatus}
    >
      {content}
    </TimelineEntryCollapsibleBox>
  );
}

/**
 * Default tool header component
 * Shows tool name, primary info, and status icon
 */
export function DefaultToolHeader({ toolData }: { toolData: ToolData }) {
  return (
    <React.Fragment>
      <Text color={UI_COLORS.TOOL}>{getFriendlyToolName(toolData.toolName)}: </Text>
      <Text color="white">{toolData.primaryInfo}</Text>
      {toolData.secondaryInfo && <Text color="gray">{toolData.secondaryInfo}</Text>}
      <Text color="gray">  </Text>
      <Text color={toolData.success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {toolData.statusIcon}
      </Text>
      {toolData.isStreaming && <Text color="gray"> (working...)</Text>}
    </React.Fragment>
  );
}

/**
 * Default tool preview component
 * Shows a brief summary for successful tools in collapsed state
 */
export function DefaultToolPreview({ toolData }: { toolData: ToolData }) {
  if (!toolData.success || !toolData.output) return null;
  
  // Show first few lines of output
  const lines = toolData.output.split('\n').slice(0, 3);
  const hasMore = toolData.output.split('\n').length > 3;
  
  return (
    <Box marginTop={1}>
      <Box flexDirection="column">
        <Text>{lines.join('\n')}</Text>
        {hasMore && <Text color="gray">(+ {toolData.output.split('\n').length - 3} lines)</Text>}
      </Box>
    </Box>
  );
}

/**
 * Default tool content component
 * Shows full output with appropriate formatting
 */
export function DefaultToolContent({ toolData }: { toolData: ToolData }) {
  if (!toolData.output && toolData.success) {
    return (
      <Box marginTop={1}>
        <Text color="gray">No output</Text>
      </Box>
    );
  }
  
  if (!toolData.success) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">Error:</Text>
        <Box marginLeft={2}>
          <Text color="red">{toolData.output || 'Unknown error'}</Text>
        </Box>
      </Box>
    );
  }
  
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{toolData.output}</Text>
    </Box>
  );
}

/**
 * Convert internal tool names to user-friendly display names
 */
function getFriendlyToolName(toolName: string): string {
  const nameMap: Record<string, string> = {
    'bash': 'Bash',
    'file-read': 'File Read',
    'file-write': 'File Write',
    'file-edit': 'File Edit',
    'file-list': 'File List',
    'file-search': 'File Search',
    'ripgrep-search': 'Search',
    'delegate': 'Delegate',
    'url-fetch': 'URL Fetch',
    'task-manager': 'Task Manager',
    'file-find': 'File Find',
    'file-insert': 'File Insert',
  };
  
  return nameMap[toolName] || toolName;
}