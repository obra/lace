// ABOUTME: Specialized renderer for bash tool executions with unix command line display
// ABOUTME: Shows commands as terminal prompts and processes stdout/stderr with proper formatting

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { CompactOutput } from '../../ui/CompactOutput.js';
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

interface BashToolRendererProps {
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

// Bash tool output structure
interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Parse bash tool result to extract structured output
function parseBashResult(result: ToolResult): BashOutput | null {
  try {
    const content = result?.content?.[0]?.text;
    if (!content) return null;
    
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && 
        typeof parsed.stdout === 'string' && 
        typeof parsed.stderr === 'string' &&
        typeof parsed.exitCode === 'number') {
      return parsed as BashOutput;
    }
    return null;
  } catch {
    return null;
  }
}

// Split text into lines and limit to maxLines, preserving empty lines
function limitLines(text: string, maxLines: number): { lines: string[], truncated: boolean } {
  if (!text) return { lines: [], truncated: false };
  
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  
  return { 
    lines: lines.slice(0, maxLines), 
    truncated: true 
  };
}

export function BashToolRenderer({
  item,
  isStreaming = defaultProps.isStreaming,
  isSelected = defaultProps.isSelected,
  onToggle,
}: BashToolRendererProps) {
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
  const command = (input.command as string) || '';

  // Parse the bash result
  const bashOutput = result ? parseBashResult(result) : null;
  const exitCode = bashOutput?.exitCode ?? null;
  const stdout = bashOutput?.stdout || '';
  const stderr = bashOutput?.stderr || '';
  
  // Determine success state
  const toolSuccess = result ? !result.isError : true;
  const commandSuccess = exitCode === 0;
  const success = toolSuccess && commandSuccess;

  // Get status icon and exit code display
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;
  const exitCodeDisplay = exitCode !== null && exitCode !== 0 ? `exit ${exitCode}` : null;

  // Create fancy label with colors and status - inline elements only
  const fancyLabel = (
    <React.Fragment>
      <Text color={UI_COLORS.TOOL}>Bash Tool: </Text>
      <Text color="white">$ {command}</Text>
      <Text color="gray">  </Text>
      <Text color={success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {statusIcon}
      </Text>
      {exitCodeDisplay && (
        <React.Fragment>
          <Text color="gray"> </Text>
          <Text color={UI_COLORS.ERROR}>{exitCodeDisplay}</Text>
        </React.Fragment>
      )}
      {isStreaming && <Text color="gray"> (running...)</Text>}
    </React.Fragment>
  );

  // Create compact summary for collapsed state (just output preview)
  const compactSummary = result && bashOutput && (
    <Box marginTop={1}>
      {commandSuccess ? (
        // Show stdout preview for successful commands
        stdout && (() => {
          const { lines, truncated } = limitLines(stdout, 3);
          const totalLines = stdout.split('\n').length;
          const remainingLines = totalLines - lines.length;
          
          return (
            <Box flexDirection="column">
              <Text>{lines.join('\n')}</Text>
              {truncated && (
                <Text color="gray">(+ {remainingLines} lines)</Text>
              )}
            </Box>
          );
        })()
      ) : (
        // Show stderr preview for failed commands
        stderr && (() => {
          const { lines, truncated } = limitLines(stderr, 3);
          const totalLines = stderr.split('\n').length;
          const remainingLines = totalLines - lines.length;
          
          return (
            <Box flexDirection="column">
              <Text color="red">{lines.join('\n')}</Text>
              {truncated && (
                <Text color="gray">(+ {remainingLines} lines)</Text>
              )}
            </Box>
          );
        })()
      )}
    </Box>
  );

  // Create expanded content showing full command output
  const expandedContent = (
    <Box flexDirection="column">
      {/* Command line */}
      <Box marginBottom={1}>
        <Text color={UI_COLORS.TOOL}>$ </Text>
        <Text color="white">{command}</Text>
      </Box>

      {/* Output sections */}
      {result && bashOutput && (
        <Box flexDirection="column">
          {/* stdout */}
          {stdout && (
            <Box marginBottom={1}>
              <Text>{stdout}</Text>
            </Box>
          )}

          {/* stderr */}
          {stderr && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="red">stderr:</Text>
              <Text color="red">{stderr}</Text>
            </Box>
          )}

          {/* Show empty indicators when no output */}
          {!stdout && !stderr && exitCode !== null && (
            <Box>
              <Text color="gray">(no output)</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Tool error handling (when tool execution itself failed) */}
      {result && result.isError && !bashOutput && (
        <Box flexDirection="column">
          <Text color="red">Tool Error:</Text>
          <Box marginLeft={2}>
            <Text color="red">{result.content?.[0]?.text || 'Unknown error'}</Text>
          </Box>
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
