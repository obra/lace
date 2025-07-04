// ABOUTME: Specialized renderer for bash tool executions using three-layer architecture
// ABOUTME: Shows commands as terminal prompts and processes stdout/stderr with proper formatting

import React from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData, type ToolExecutionItem } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { ToolResult } from '../../../../../tools/types.js';
import { limitLines } from './useToolRenderer.js';

interface BashToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

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

// Custom preview component for bash output
function BashPreview({ toolData }: { toolData: any }) {
  if (!toolData.result || toolData.isStreaming) return null;
  
  const bashOutput = parseBashResult(toolData.result);
  if (!bashOutput) return null;
  
  const { stdout, stderr, exitCode } = bashOutput;
  const commandSuccess = exitCode === 0;
  
  if (commandSuccess && stdout) {
    const { lines, truncated, remaining } = limitLines(stdout, 3);
    return (
      <Box flexDirection="column">
        <Text>{lines.join('\n')}</Text>
        {truncated && <Text color="gray">(+ {remaining} lines)</Text>}
      </Box>
    );
  } else if (!commandSuccess && stderr) {
    const { lines, truncated, remaining } = limitLines(stderr, 3);
    return (
      <Box flexDirection="column">
        <Text color="red">{lines.join('\n')}</Text>
        {truncated && <Text color="gray">(+ {remaining} lines)</Text>}
      </Box>
    );
  }
  
  return null;
}

// Custom content component for bash output
function BashContent({ toolData }: { toolData: any }) {
  const bashOutput = toolData.result ? parseBashResult(toolData.result) : null;
  const { stdout = '', stderr = '', exitCode = null } = bashOutput || {};
  
  return (
    <Box flexDirection="column">
      {/* Command line */}
      <Box marginBottom={1}>
        <Text color="cyan">$ </Text>
        <Text color="white">{toolData.input.command as string}</Text>
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
}

export function BashToolRenderer({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}: BashToolRendererProps) {
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Layer 2: State management
  const toolState = useToolState(isSelected, onToggle);
  
  // Add bash-specific stats
  if (toolData.result && toolData.success) {
    const bashOutput = parseBashResult(toolData.result);
    if (bashOutput && bashOutput.exitCode !== 0) {
      toolData.stats = `exit ${bashOutput.exitCode}`;
      toolData.success = false; // Override success based on exit code
    }
  }
  
  // Layer 3: Display with custom components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        preview: <BashPreview toolData={toolData} />,
        content: <BashContent toolData={toolData} />
      }}
    />
  );
}
