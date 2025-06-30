// ABOUTME: Specialized renderer for file-list tool executions with tree structure display
// ABOUTME: Shows directory trees with proper indentation, file sizes, and type indicators

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { useTimelineItemExpansion } from '../hooks/useTimelineExpansionToggle.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

interface FileListToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean; // Whether timeline cursor is on this item
  onToggle?: () => void;
}

// Default props for optional boolean values
const defaultProps = {
  isStreaming: false,
  isSelected: false,
} as const;

// Helper function to format file sizes
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper function to count tree elements for summary
function countTreeElements(text: string): { files: number; dirs: number; lines: number } {
  const lines = text.split('\n');
  let files = 0;
  let dirs = 0;
  
  for (const line of lines) {
    if (line.includes('(') && line.includes('bytes)')) {
      files++;
    } else if (line.includes('/') && !line.includes('bytes)')) {
      dirs++;
    }
  }
  
  return { files, dirs, lines: lines.length };
}

// Helper function to extract directory path from arguments
function getDirectoryPath(input: Record<string, unknown>): string {
  const path = input.path as string;
  if (!path || path === '.') {
    return 'current directory';
  }
  return path;
}

// Helper function to create parameter summary
function getParameterSummary(input: Record<string, unknown>): string {
  const parts: string[] = [];
  
  if (input.recursive) parts.push('recursive');
  if (input.includeHidden) parts.push('hidden files');
  if (input.pattern) parts.push(`pattern: ${input.pattern}`);
  if (input.maxDepth && input.maxDepth !== 3) parts.push(`depth: ${input.maxDepth}`);
  
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function FileListToolRenderer({
  item,
  isStreaming = defaultProps.isStreaming,
  isSelected = defaultProps.isSelected,
  onToggle,
}: FileListToolRendererProps) {
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
  const directoryPath = getDirectoryPath(input);
  const parameterSummary = getParameterSummary(input);

  // Get output and analyze it
  const success = result ? !result.isError : true;
  const output = result?.content?.[0]?.text || '';
  const isEmpty = output === 'No files found';
  
  // Count elements for summary
  const stats = isEmpty ? { files: 0, dirs: 0, lines: 0 } : countTreeElements(output);
  
  // Get status icon
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;

  // Create fancy label with colors and status
  const fancyLabel = (
    <React.Fragment>
      <Text color={UI_COLORS.TOOL}>File List: </Text>
      <Text color="white">{directoryPath}</Text>
      <Text color="gray">{parameterSummary}</Text>
      <Text color="gray">  </Text>
      <Text color={success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {statusIcon}
      </Text>
      {isStreaming && <Text color="gray"> (scanning...)</Text>}
    </React.Fragment>
  );

  // Create compact summary for collapsed state
  const compactSummary = result && success && (
    <Box marginTop={1}>
      {isEmpty ? (
        <Text color="gray">No files found</Text>
      ) : (
        <Box flexDirection="column">
          <Text color="gray">
            {stats.files} files, {stats.dirs} directories
          </Text>
          {/* Show first few lines of tree as preview */}
          {(() => {
            const lines = output.split('\n').slice(0, 3);
            return lines.map((line, index) => (
              <Text key={index} color="gray">
                {line}
              </Text>
            ));
          })()}
          {stats.lines > 3 && (
            <Text color="gray">... and {stats.lines - 3} more lines</Text>
          )}
        </Box>
      )}
    </Box>
  );

  // Create expanded content showing full directory tree
  const expandedContent = (
    <Box flexDirection="column">
      {/* Full tree output */}
      {result && (
        <Box flexDirection="column">
          {success ? (
            isEmpty ? (
              <Text color="gray">No files found matching the criteria</Text>
            ) : (
              <Box flexDirection="column">
                <Box marginTop={1}>
                  <Text color={UI_COLORS.SUCCESS}>
                    {stats.files} files, {stats.dirs} directories
                  </Text>
                </Box>
                <Text>{output}</Text>
              </Box>
            )
          ) : (
            <Box flexDirection="column">
              <Text color="red">Error:</Text>
              <Box marginLeft={2}>
                <Text color="red">{output || 'Unknown error'}</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  return (
    <TimelineEntryCollapsibleBox
      label={fancyLabel}
      summary={compactSummary}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      {expandedContent}
    </TimelineEntryCollapsibleBox>
  );
}