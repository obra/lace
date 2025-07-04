// ABOUTME: Renderer for bash tool executions with direct component composition
// ABOUTME: Shows commands as terminal prompts and processes stdout/stderr with proper formatting

import React from 'react';
import { Box, Text } from 'ink';
import { ToolHeader, ToolPreview, ToolContent, useToolExpansion, limitLines, type ToolRendererProps } from './components/shared.js';
import { ToolResult } from '../../../../../tools/types.js';

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

export function BashToolRenderer({ item, isSelected = false, onToggle }: ToolRendererProps) {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly - no abstraction needed
  const { command, description } = item.call.arguments as { command: string; description?: string };
  const bashOutput = item.result ? parseBashResult(item.result) : null;
  const hasError = item.result?.isError || (bashOutput && bashOutput.exitCode !== 0);
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Get output for preview
  const output = bashOutput ? (bashOutput.stdout || bashOutput.stderr) : '';
  
  return (
    <Box flexDirection="column">
      <ToolHeader icon="🔨" status={status}>
        <Text bold>bash</Text>
        <Text> $ {command}</Text>
        {description && <Text dim> - {description}</Text>}
        {bashOutput && bashOutput.exitCode !== 0 && (
          <>
            <Text color="gray"> - </Text>
            <Text color="cyan">exit {bashOutput.exitCode}</Text>
          </>
        )}
      </ToolHeader>
      
      {!isExpanded && output && (
        <ToolPreview>
          {(() => {
            const { lines, truncated, remaining } = limitLines(output, 3);
            const isError = bashOutput && !bashOutput.stdout && bashOutput.stderr;
            return (
              <Box flexDirection="column">
                <Text color={isError ? 'red' : undefined}>{lines.join('\n')}</Text>
                {truncated && <Text color="gray">(+ {remaining} lines)</Text>}
              </Box>
            );
          })()}
        </ToolPreview>
      )}
      
      {isExpanded && (
        <ToolContent>
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
                <Box flexDirection="column" marginTop={bashOutput.stdout ? 1 : 0 }>
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
        </ToolContent>
      )}
    </Box>
  );
}