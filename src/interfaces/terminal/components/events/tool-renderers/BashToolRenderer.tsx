// ABOUTME: Bash tool renderer using the new three-layer component architecture
// ABOUTME: Demonstrates clean separation of data processing, state management, and display components

import React from 'react';
import { Box, Text } from 'ink';
import { ToolResult } from '../../../../../tools/types.js';
import { useToolData, ToolExecutionItem, ToolData } from '../hooks/useToolData.js';
import { useToolState } from '../hooks/useToolState.js';
import { ToolDisplay } from '../components/ToolDisplay.js';
import { UI_COLORS } from '../../../theme.js';

// Bash tool-specific interfaces
interface BashToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Main Bash tool renderer using three-layer architecture:
 * 1. Data processing (useToolData + bash-specific parsing)
 * 2. State management (useToolState)
 * 3. Display (ToolDisplay with bash-specific components)
 */
export function BashToolRenderer({ 
  item, 
  isStreaming = false, 
  isSelected = false, 
  onToggle 
}: BashToolRendererProps) {
  
  // Layer 1: Data processing
  const toolData = useToolData(item);
  const bashData = useBashData(item.result);
  
  // Layer 2: State management
  const toolState = useToolState(toolData, isSelected, onToggle);
  
  // Layer 3: Display with bash-specific components
  // Pass computed data to avoid recomputation in child components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      components={{
        header: (props) => <BashHeader {...props} bashData={bashData} />,
        preview: (props) => <BashPreview {...props} bashData={bashData} />,
        content: (props) => <BashContent {...props} bashData={bashData} />,
      }}
    />
  );
}

/**
 * Hook for parsing bash-specific output data
 */
function useBashData(result: ToolResult | undefined): BashOutput | null {
  if (!result) return null;
  
  try {
    const content = result.content?.[0]?.text;
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

/**
 * Bash-specific header component
 * Shows command with terminal prompt styling
 */
function BashHeader({ toolData, bashData }: { toolData: ToolData; bashData: BashOutput | null }) {
  const command = toolData.input.command as string || '';
  
  return (
    <React.Fragment>
      <Text color={UI_COLORS.TOOL}>Bash: </Text>
      <Text color="cyan">$ </Text>
      <Text color="white">{command}</Text>
      <Text color="gray">  </Text>
      <Text color={toolData.success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {toolData.statusIcon}
      </Text>
      {toolData.isStreaming && <Text color="gray"> (running...)</Text>}
    </React.Fragment>
  );
}

/**
 * Bash-specific preview component
 * Shows stdout preview for success, stderr for errors
 */
function BashPreview({ toolData, bashData }: { toolData: ToolData; bashData: BashOutput | null }) {
  if (!bashData) return null;
  
  const { stdout, stderr, exitCode } = bashData;
  const commandSuccess = exitCode === 0;
  
  if (commandSuccess && stdout) {
    const lines = stdout.split('\n').slice(0, 3);
    const hasMore = stdout.split('\n').length > 3;
    
    return (
      <Box marginTop={1}>
        <Box flexDirection="column">
          <Text>{lines.join('\n')}</Text>
          {hasMore && <Text color="gray">(+ {stdout.split('\n').length - 3} lines)</Text>}
        </Box>
      </Box>
    );
  }
  
  if (!commandSuccess && stderr) {
    const lines = stderr.split('\n').slice(0, 3);
    const hasMore = stderr.split('\n').length > 3;
    
    return (
      <Box marginTop={1}>
        <Box flexDirection="column">
          <Text color="red">{lines.join('\n')}</Text>
          {hasMore && <Text color="gray">(+ {stderr.split('\n').length - 3} lines)</Text>}
        </Box>
      </Box>
    );
  }
  
  return null;
}

/**
 * Bash-specific content component
 * Shows full command output with proper formatting
 */
function BashContent({ toolData, bashData }: { toolData: ToolData; bashData: BashOutput | null }) {
  const command = toolData.input.command as string || '';
  
  if (!bashData) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">Error parsing bash output</Text>
      </Box>
    );
  }
  
  const { stdout, stderr, exitCode } = bashData;
  
  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Command line */}
      <Box marginBottom={1}>
        <Text color="cyan">$ </Text>
        <Text color="white">{command}</Text>
      </Box>

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

      {/* Exit code indicator */}
      {exitCode !== 0 && (
        <Box marginTop={1}>
          <Text color="red">Exit code: {exitCode}</Text>
        </Box>
      )}

      {/* Empty output indicator */}
      {!stdout && !stderr && exitCode !== null && (
        <Box>
          <Text color="gray">(no output)</Text>
        </Box>
      )}
    </Box>
  );
}