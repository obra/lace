// ABOUTME: Standardized hook for tool renderers with common patterns and structures
// ABOUTME: Eliminates boilerplate and ensures consistent UI behavior across all tool renderers

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { useTimelineItemExpansion } from '../hooks/useTimelineExpansionToggle.js';
import { type MarkerStatus } from '../../ui/SideMarkerRenderer.js';

// Extract tool execution timeline item type
export type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

// Standard props interface for all tool renderers
export interface ToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Tool-specific data parsed from output
export interface ToolOutputData {
  success: boolean;
  isEmpty?: boolean;
  stats?: string;
  previewContent?: React.ReactNode;
  mainContent?: React.ReactNode;
  errorMessage?: string;
}

// Configuration for tool-specific rendering
export interface ToolRendererConfig {
  toolName: string;
  streamingAction: string; // "scanning...", "searching...", "writing...", etc.
  getPrimaryInfo: (input: Record<string, unknown>) => string;
  getSecondaryInfo?: (input: Record<string, unknown>) => string;
  parseOutput: (
    result: ToolResult | undefined,
    input: Record<string, unknown>
  ) => ToolOutputData;
}

// Standard hook that handles all common tool renderer patterns
export function useToolRenderer(
  item: ToolExecutionItem,
  config: ToolRendererConfig,
  isStreaming: boolean = false,
  isSelected: boolean = false,
  onToggle?: () => void
) {
  // Use shared expansion management for consistent behavior
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected,
    (expanded) => onToggle?.()
  );

  // Create handler that works with TimelineEntryCollapsibleBox interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  const { call, result } = item;
  const { arguments: input } = call;

  // Parse tool output using provided parser
  const outputData = config.parseOutput(result, input);
  const { success, stats, previewContent, mainContent, errorMessage } = outputData;

  // Get primary and secondary info
  const primaryInfo = config.getPrimaryInfo(input);
  const secondaryInfo = config.getSecondaryInfo?.(input) || '';

  // Get status icon and marker status
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;
  const markerStatus: MarkerStatus = isStreaming ? 'pending' : success ? 'success' : result ? 'error' : 'none';

  // Create standardized fancy label
  const fancyLabel = (
    <React.Fragment>
      <Text color={success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {statusIcon}
      </Text>
      <Text color="gray"> </Text>
      <Text color={UI_COLORS.TOOL}>{config.toolName}: </Text>
      <Text color="white">{primaryInfo}</Text>
      {secondaryInfo && <Text color="gray">{secondaryInfo}</Text>}
      {isStreaming && <Text color="gray"> ({config.streamingAction})</Text>}
    </React.Fragment>
  );

  // Create standardized compact summary
  const compactSummary = result && success && (stats || previewContent) && (
    <Box marginTop={1}>
      <Box flexDirection="column">
        {stats && <Text color="gray">{stats}</Text>}
        {previewContent}
      </Box>
    </Box>
  );

  // Create standardized expanded content
  const expandedContent = (
    <Box flexDirection="column">
      {result && (
        <Box flexDirection="column">
          {success ? (
            outputData.isEmpty ? (
              <Box marginTop={1}>
                <Text color="gray">No results</Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                {stats && (
                  <Box marginTop={1}>
                    <Text color={UI_COLORS.SUCCESS}>{stats}</Text>
                  </Box>
                )}
                {mainContent}
              </Box>
            )
          ) : (
            <Box flexDirection="column">
              <Text color="red">Error:</Text>
              <Box marginLeft={2}>
                <Text color="red">{errorMessage || 'Unknown error'}</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  // Return standardized timeline entry
  const timelineEntry = (
    <TimelineEntryCollapsibleBox
      label={fancyLabel}
      summary={compactSummary}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status={markerStatus}
      isExpandable={true}
    >
      {expandedContent}
    </TimelineEntryCollapsibleBox>
  );

  return {
    timelineEntry,
    outputData,
    isExpanded,
    handleExpandedChange,
  };
}

// Utility function for limiting lines with truncation info
export function limitLines(text: string, maxLines: number): { 
  lines: string[], 
  truncated: boolean,
  remaining: number 
} {
  if (!text) return { lines: [], truncated: false, remaining: 0 };
  
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { lines, truncated: false, remaining: 0 };
  }
  
  return { 
    lines: lines.slice(0, maxLines), 
    truncated: true,
    remaining: lines.length - maxLines
  };
}

// Utility function for basic tool result parsing
export function parseBasicToolResult(result: ToolResult | undefined): {
  success: boolean;
  output: string;
} {
  const success = result ? !result.isError : true;
  const output = result?.content?.[0]?.text || '';
  return { success, output };
}