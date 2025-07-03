// ABOUTME: Specialized renderer for bash tool executions with unix command line display
// ABOUTME: Shows commands as terminal prompts and processes stdout/stderr with proper formatting

import React from 'react';
import { Box, Text } from 'ink';
import { ToolResult } from '../../../../../tools/types.js';
import { 
  useToolRenderer, 
  ToolRendererProps, 
  ToolOutputData,
  limitLines,
  parseBasicToolResult 
} from './useToolRenderer.js';

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

export function BashToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: ToolRendererProps) {
  
  const { timelineEntry } = useToolRenderer(
    item,
    {
      toolName: 'Bash Tool',
      streamingAction: 'running...',
      
      getPrimaryInfo: (input) => {
        const command = (input.command as string) || '';
        return `$ ${command}`;
      },
      
      parseOutput: (result, input) => {
        const { success, output } = parseBasicToolResult(result);
        
        if (!success) {
          return {
            success: false,
            errorMessage: output || 'Unknown error'
          };
        }

        // Parse the bash result
        const bashOutput = result ? parseBashResult(result) : null;
        const exitCode = bashOutput?.exitCode ?? null;
        const stdout = bashOutput?.stdout || '';
        const stderr = bashOutput?.stderr || '';
        
        // Determine command success
        const commandSuccess = exitCode === 0;
        const overallSuccess = success && commandSuccess;
        
        // Create exit code display
        const exitCodeDisplay = exitCode !== null && exitCode !== 0 ? `exit ${exitCode}` : null;
        const stats = exitCodeDisplay || undefined;

        // Create preview content (stdout for success, stderr for failure)
        let previewContent = null;
        if (bashOutput) {
          if (commandSuccess && stdout) {
            // Show stdout preview for successful commands
            const { lines, truncated, remaining } = limitLines(stdout, 3);
            previewContent = (
              <Box flexDirection="column">
                <Text>{lines.join('\n')}</Text>
                {truncated && (
                  <Text color="gray">(+ {remaining} lines)</Text>
                )}
              </Box>
            );
          } else if (!commandSuccess && stderr) {
            // Show stderr preview for failed commands
            const { lines, truncated, remaining } = limitLines(stderr, 3);
            previewContent = (
              <Box flexDirection="column">
                <Text color="red">{lines.join('\n')}</Text>
                {truncated && (
                  <Text color="gray">(+ {remaining} lines)</Text>
                )}
              </Box>
            );
          }
        }

        // Create main content for expanded view
        const mainContent = (
          <Box flexDirection="column">
            {/* Command line */}
            <Box marginBottom={1}>
              <Text color="cyan">$ </Text>
              <Text color="white">{input.command as string}</Text>
            </Box>

            {/* Output sections */}
            {bashOutput && (
              <Box flexDirection="column">
                {/* stdout */}
                {stdout && (
                  <Box>
                    <Text>{stdout}</Text>
                  </Box>
                )}

                {/* stderr */}
                {stderr && (
                  <Box flexDirection="column" marginTop={stdout ? 1 : 0 }>
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
          </Box>
        );

        return {
          success: overallSuccess,
          stats,
          previewContent,
          mainContent
        };
      }
    },
    isStreaming,
    isSelected,
    onToggle
  );

  return timelineEntry;
}
