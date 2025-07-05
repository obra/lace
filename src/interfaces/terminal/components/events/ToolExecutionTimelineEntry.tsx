// ABOUTME: Wrapper component that integrates tool renderers with TimelineEntry
// ABOUTME: Provides consistent UI chrome (expansion indicators, status, sizing) for all tool executions

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '../ui/TimelineEntry.js';
import { useTimelineItemExpansion } from './hooks/useTimelineExpansionToggle.js';
import { ToolRendererProps } from './tool-renderers/components/shared.js';
import { UI_SYMBOLS } from '../../theme.js';
import type { TimelineItem } from '../../../thread-processor.js';

interface ToolExecutionTimelineEntryProps {
  item: Extract<TimelineItem, { type: 'tool_execution' }>;
  ToolRenderer: React.ComponentType<ToolRendererProps>;
  isSelected: boolean;
  onToggle?: () => void;
}

export function ToolExecutionTimelineEntry({
  item,
  ToolRenderer,
  isSelected,
  onToggle,
}: ToolExecutionTimelineEntryProps) {
  // Use expansion state management
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected || false, onToggle);

  // Create handler that works with TimelineEntry interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  // Determine status
  const isRunning = !item.result;
  const hasError = item.result?.isError;
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Extract tool info for header
  const toolName = item.call.name;
  const toolArgs = item.call.arguments;

  // Build tool-specific label based on tool type
  const getToolLabel = () => {
    switch (toolName) {
      case 'bash': {
        const args = toolArgs as { command: string; description?: string };
        return (
          <Box>
            <Text bold>bash: </Text>
            <Text>{args.command}</Text>
            {args.description && (
              <React.Fragment>
                <Text> - </Text>
                <Text dimColor>{args.description}</Text>
              </React.Fragment>
            )}
          </Box>
        );
      }
      case 'file-write': {
        const args = toolArgs as { file_path: string; content: string };
        const charCount = args.content?.length || 0;
        return (
          <Box>
            <Text bold>file-write: </Text>
            <Text>{args.file_path}</Text>
            <Text dimColor> ({charCount} chars)</Text>
          </Box>
        );
      }
      case 'file-edit': {
        const args = toolArgs as { file_path: string; old_text: string; new_text: string };
        const oldLines = args.old_text?.split('\n').length || 0;
        const newLines = args.new_text?.split('\n').length || 0;
        return (
          <Box>
            <Text bold>file-edit: </Text>
            <Text>{args.file_path}</Text>
            <Text dimColor> (-{oldLines} +{newLines} lines)</Text>
          </Box>
        );
      }
      case 'file-list': {
        const args = toolArgs as { path: string; recursive?: boolean };
        return (
          <Box>
            <Text bold>file-list: </Text>
            <Text>{args.path}</Text>
            {args.recursive && <Text dimColor> (recursive)</Text>}
          </Box>
        );
      }
      case 'ripgrep-search': {
        const args = toolArgs as { pattern: string; path?: string };
        return (
          <Box>
            <Text bold>ripgrep-search: </Text>
            <Text>"{args.pattern}"</Text>
            {args.path && (
              <React.Fragment>
                <Text> in </Text>
                <Text>{args.path}</Text>
              </React.Fragment>
            )}
          </Box>
        );
      }
      default: {
        // Generic fallback
        const firstArg = Object.values(toolArgs)[0];
        return (
          <Box>
            <Text bold>{toolName}: </Text>
            {typeof firstArg === 'string' && firstArg.length < 50 && (
              <Text>{firstArg}</Text>
            )}
          </Box>
        );
      }
    }
  };

  const label = getToolLabel();

  // Get tool-specific content by rendering the tool renderer
  const toolContent = (
    <ToolRenderer
      item={item}
      isSelected={isSelected}
      onToggle={onToggle}
    />
  );

  return (
    <TimelineEntry
      label={label}
      summary={!isExpanded ? toolContent : null}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status={status}
      isExpandable={true}
    >
      {isExpanded ? toolContent : null}
    </TimelineEntry>
  );
}