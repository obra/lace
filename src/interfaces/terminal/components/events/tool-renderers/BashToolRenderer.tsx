// ABOUTME: Renderer for bash tool executions using TimelineEntry
// ABOUTME: Shows commands as terminal prompts and processes stdout/stderr with proper formatting

import React from 'react';
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
import { ToolResult } from '~/tools/types.js';
import { logger } from '~/utils/logger.js';

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
    if (!content) {
      logger.debug('BashToolRenderer: No content in result');
      return null;
    }

    const parsed = JSON.parse(content);

    // Validate the parsed structure
    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn('BashToolRenderer: Parsed result is not an object', { parsed });
      return null;
    }

    if (
      typeof parsed.stdout !== 'string' ||
      typeof parsed.stderr !== 'string' ||
      typeof parsed.exitCode !== 'number'
    ) {
      logger.warn('BashToolRenderer: Invalid bash result structure', {
        hasStdout: typeof parsed.stdout,
        hasStderr: typeof parsed.stderr,
        hasExitCode: typeof parsed.exitCode,
        parsed,
      });
      return null;
    }

    return parsed as BashOutput;
  } catch (error) {
    logger.warn('BashToolRenderer: Failed to parse bash result JSON', {
      error: error instanceof Error ? error.message : String(error),
      content: result?.content?.[0]?.text?.slice(0, 200) + '...', // Log first 200 chars
    });
    return null;
  }
}

export function BashToolRenderer({ item }: ToolRendererProps) {
  const { isExpanded } = useTimelineItem();

  // Extract and validate data
  const args = item.call.arguments;

  if (typeof args.command !== 'string') {
    logger.warn('BashToolRenderer: Invalid command argument', {
      command: args.command,
      callId: item.call.id,
    });
    return null;
  }

  const command = args.command;
  const description = typeof args.description === 'string' ? args.description : undefined;

  const bashOutput = item.result ? parseBashResult(item.result) : null;
  const hasError = item.result?.isError || (bashOutput && bashOutput.exitCode !== 0);
  const isRunning = !item.result;

  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';

  // Get output for preview and size calculation
  const output = bashOutput ? bashOutput.stdout || bashOutput.stderr : '';
  const outputLines = output ? output.split('\n').length : 0;

  // Build header with command and description
  const header = (
    <Box>
      <Text bold>bash: </Text>
      <Text>{command}</Text>
      {description && (
        <React.Fragment>
          <Text> - </Text>
          <Text dimColor>{description}</Text>
        </React.Fragment>
      )}
      {bashOutput && bashOutput.exitCode !== 0 && (
        <React.Fragment>
          <Text color="gray"> - </Text>
          <Text color="cyan">exit {bashOutput.exitCode}</Text>
        </React.Fragment>
      )}
      {outputLines > 0 && (
        <React.Fragment>
          <Text color="gray"> - </Text>
          <Text color="gray">{outputLines} lines</Text>
        </React.Fragment>
      )}
    </Box>
  );

  // Build preview content
  const preview = output
    ? (() => {
        const { lines, truncated, remaining } = limitLines(output, 3);
        const isError = bashOutput && !bashOutput.stdout && bashOutput.stderr;
        return (
          <Box flexDirection="column">
            <Text color={isError ? 'red' : undefined}>{lines.join('\n')}</Text>
            {truncated && <Text color="gray">(+ {remaining} lines)</Text>}
          </Box>
        );
      })()
    : null;

  // Build expanded content
  const expandedContent = (
    <Box flexDirection="column">
      {/* Command line */}
      <Box marginBottom={1}>
        <Text color="cyan">$ </Text>
        <Text color="white">{command}</Text>
      </Box>

      {/* Output sections */}
      {bashOutput && (
        <Box flexDirection="column">
          {/* stdout */}
          {bashOutput.stdout && (
            <Box>
              <Text>{bashOutput.stdout}</Text>
            </Box>
          )}

          {/* stderr */}
          {bashOutput.stderr && (
            <Box flexDirection="column" marginTop={bashOutput.stdout ? 1 : 0}>
              <Text color="red">stderr:</Text>
              <Text color="red">{bashOutput.stderr}</Text>
            </Box>
          )}

          {/* Show empty indicators when no output */}
          {!bashOutput.stdout && !bashOutput.stderr && bashOutput.exitCode !== null && (
            <Box>
              <Text color="gray">(no output)</Text>
            </Box>
          )}
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
