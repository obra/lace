// ABOUTME: Renderer for bash tool executions using TimelineEntry with context
// ABOUTME: Shows commands as terminal prompts and processes stdout/stderr with proper formatting

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry } from '../../ui/TimelineEntry.js';
import { ToolResult } from '../../../../../tools/types.js';
import { limitLines } from './components/shared.js';

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

interface BashToolRendererProps {
  item: {
    type: 'tool_execution';
    call: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
    result?: ToolResult;
    timestamp: Date;
    callId: string;
  };
}

export function BashToolRenderer({ item }: BashToolRendererProps) {
  // Extract data
  const { command, description } = item.call.arguments as { command: string; description?: string };
  const bashOutput = item.result ? parseBashResult(item.result) : null;
  const hasError = item.result?.isError || (bashOutput && bashOutput.exitCode !== 0);
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Get output for preview
  const output = bashOutput ? (bashOutput.stdout || bashOutput.stderr) : '';
  
  // Build label
  const label = (
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
    </Box>
  );
  
  // Build preview (collapsed state)
  const preview = output ? (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      {(() => {
        const { lines, truncated, remaining } = limitLines(output, 3);
        const isError = bashOutput && !bashOutput.stdout && bashOutput.stderr;
        return (
          <React.Fragment>
            <Text color={isError ? 'red' : undefined}>{lines.join('\n')}</Text>
            {truncated && <Text color="gray">(+ {remaining} lines)</Text>}
          </React.Fragment>
        );
      })()}
    </Box>
  ) : null;
  
  // Build full content (expanded state)
  const content = (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
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
      
      {/* Running state */}
      {isRunning && (
        <Box>
          <Text color="gray">Running...</Text>
        </Box>
      )}
    </Box>
  );
  
  return (
    <TimelineEntry
      label={label}
      summary={preview}
      status={status}
      isExpandable={true}
    >
      {content}
    </TimelineEntry>
  );
}