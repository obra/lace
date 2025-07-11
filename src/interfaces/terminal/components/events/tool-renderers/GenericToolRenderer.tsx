// ABOUTME: Generic tool renderer using TimelineEntry for unknown/unsupported tools
// ABOUTME: Provides fallback display for any tool execution with input/output visualization

import React, { forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import {
  TimelineEntry,
  TimelineStatus,
} from '~/interfaces/terminal/components/ui/TimelineEntry.js';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';
import {
  limitLines,
  type ToolRendererProps,
} from '~/interfaces/terminal/components/events/tool-renderers/components/shared.js';
import { TimelineItemRef } from '~/interfaces/terminal/components/timeline-item-focus.js';

// Extract primary info from tool arguments
function getPrimaryInfo(toolName: string, args: Record<string, unknown>): string {
  // Special handling for known tools
  switch (toolName) {
    case 'bash':
      return `$ ${args.command || ''}`;
    case 'file-write':
    case 'file-read':
    case 'file-edit':
      return (args.path || args.file_path || '') as string;
    case 'ripgrep-search':
      return `"${args.pattern || ''}" in ${args.path || 'current directory'}`;
    case 'delegate':
      return `"${args.task || args.prompt || 'Unknown task'}"`;
    default:
      // For unknown tools, use the first argument value if it's short
      const firstValue = Object.values(args)[0];
      if (firstValue && typeof firstValue === 'string' && firstValue.length <= 50) {
        return firstValue;
      }
      return 'unknown';
  }
}

export const GenericToolRenderer = forwardRef<TimelineItemRef, ToolRendererProps>(
  ({ item }, ref) => {
    // Generic tool renderer doesn't support focus entry
    useImperativeHandle(
      ref,
      () => ({
        enterFocus: () => {
          // No-op for generic tool renderer
        },
      }),
      []
    );

    useTimelineItem();

    // Extract data directly
    const toolName = item.call.name;
    const args = item.call.arguments;
    const output = item.result?.content?.[0]?.text || '';
    const hasError = item.result?.isError;
    const isRunning = !item.result;

    // Determine status
    const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

    // Get primary info
    const primaryInfo = getPrimaryInfo(toolName, args);

    // Build header with tool name and generic indicator
    const header = (
      <Box>
        <Text color="magenta" bold>
          {toolName}
        </Text>
        <Text color="gray">: </Text>
        <Text color="white">{primaryInfo}</Text>
        <Text color="magenta"> [GENERIC]</Text>
      </Box>
    );

    // Build preview content
    const preview =
      output && item.result && !isRunning
        ? (() => {
            const { lines, truncated, remaining } = limitLines(output, 3);
            return (
              <Box flexDirection="column">
                {lines.map((line, index) => (
                  <Text key={index} dimColor>
                    {line}
                  </Text>
                ))}
                {truncated && <Text color="gray">(+ {remaining} lines)</Text>}
              </Box>
            );
          })()
        : null;

    // Build expanded content
    const expandedContent = (
      <Box flexDirection="column">
        {/* Input parameters */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow">Input:</Text>
          <Box marginLeft={2}>
            <Text>{JSON.stringify(args, null, 2)}</Text>
          </Box>
        </Box>

        {/* Output or Error */}
        {item.result && (
          <Box flexDirection="column">
            <Text color={hasError ? 'red' : 'green'}>{hasError ? 'Error:' : 'Output:'}</Text>
            <Box marginLeft={2}>
              <Text color={hasError ? 'red' : undefined}>{output || 'No output'}</Text>
            </Box>
          </Box>
        )}
      </Box>
    );

    return (
      <TimelineEntry label={header} summary={preview} status={status} isExpandable={true}>
        {expandedContent}
      </TimelineEntry>
    );
  }
);
