// ABOUTME: File list tool renderer using the new three-layer component architecture  
// ABOUTME: Shows directory trees with proper indentation, file sizes, and statistics using clean component composition

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useToolData, ToolExecutionItem, ToolData } from '../hooks/useToolData.js';
import { useToolState } from '../hooks/useToolState.js';
import { ToolDisplay } from '../components/ToolDisplay.js';
import { UI_COLORS } from '../../../theme.js';

// File list tool-specific interfaces
interface FileListToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

interface FileListData {
  isEmpty: boolean;
  stats: {
    files: number;
    dirs: number;
    lines: number;
  };
  parameters: string[];
}

/**
 * Main File List tool renderer using three-layer architecture:
 * 1. Data processing (useToolData + file-list-specific parsing)
 * 2. State management (useToolState)
 * 3. Display (ToolDisplay with file-list-specific components)
 */
export function FileListToolRenderer({ 
  item, 
  isStreaming = false, 
  isSelected = false, 
  onToggle 
}: FileListToolRendererProps) {
  
  // Layer 1: Data processing
  const toolData = useToolData(item);
  const fileListData = useFileListData(item);
  
  // Layer 2: State management
  const toolState = useToolState(toolData, isSelected, onToggle);
  
  // Layer 3: Display with file-list-specific components
  // Pass computed data to avoid recomputation in child components
  return (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      components={{
        header: (props) => <FileListHeader {...props} fileListData={fileListData} />,
        preview: (props) => <FileListPreview {...props} fileListData={fileListData} />,
        content: (props) => <FileListContent {...props} fileListData={fileListData} />,
      }}
    />
  );
}

/**
 * Hook for parsing file-list-specific data
 */
function useFileListData(item: ToolExecutionItem): FileListData {
  return useMemo(() => {
    const { input } = item.call.arguments;
    const output = item.result?.content?.[0]?.text || '';
    
    const isEmpty = output === 'No files found';
    const stats = isEmpty ? { files: 0, dirs: 0, lines: 0 } : countTreeElements(output);
    
    // Extract parameters for display
    const parameters: string[] = [];
    if (input.recursive) parameters.push('recursive');
    if (input.includeHidden) parameters.push('hidden files');
    if (input.pattern) parameters.push(`pattern: ${input.pattern}`);
    if (input.maxDepth && input.maxDepth !== 3) parameters.push(`depth: ${input.maxDepth}`);
    
    return {
      isEmpty,
      stats,
      parameters,
    };
  }, [item]);
}

/**
 * File list-specific header component
 * Shows directory path and scan parameters
 */
function FileListHeader({ toolData, fileListData }: { toolData: ToolData; fileListData: FileListData }) {
  const path = getDirectoryPath(toolData.input);
  const parameterText = fileListData.parameters.length > 0 ? ` (${fileListData.parameters.join(', ')})` : '';
  
  return (
    <React.Fragment>
      <Text color={UI_COLORS.TOOL}>File List: </Text>
      <Text color="white">{path}</Text>
      {parameterText && <Text color="gray">{parameterText}</Text>}
      <Text color="gray">  </Text>
      <Text color={toolData.success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
        {toolData.statusIcon}
      </Text>
      {toolData.isStreaming && <Text color="gray"> (scanning...)</Text>}
    </React.Fragment>
  );
}

/**
 * File list-specific preview component
 * Shows first few lines of directory tree
 */
function FileListPreview({ toolData, fileListData }: { toolData: ToolData; fileListData: FileListData }) {
  if (fileListData.isEmpty) {
    return (
      <Box marginTop={1}>
        <Text color="gray">No files found</Text>
      </Box>
    );
  }
  
  const lines = toolData.output.split('\n').slice(0, 3);
  const hasMore = toolData.output.split('\n').length > 3;
  
  return (
    <Box marginTop={1}>
      <Box flexDirection="column">
        <Text color="gray">{fileListData.stats.files} files, {fileListData.stats.dirs} directories</Text>
        {lines.map((line: string, index: number) => (
          <Text key={index} color="gray">{line}</Text>
        ))}
        {hasMore && (
          <Text color="gray">... and {toolData.output.split('\n').length - 3} more lines</Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * File list-specific content component
 * Shows full directory tree or empty state
 */
function FileListContent({ toolData, fileListData }: { toolData: ToolData; fileListData: FileListData }) {
  if (fileListData.isEmpty) {
    return (
      <Box marginTop={1}>
        <Text color="gray">No files found</Text>
      </Box>
    );
  }
  
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text color={UI_COLORS.SUCCESS}>
          {fileListData.stats.files} files, {fileListData.stats.dirs} directories
        </Text>
      </Box>
      <Text>{toolData.output}</Text>
    </Box>
  );
}

// Helper functions (extracted from original implementation)

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

function getDirectoryPath(input: Record<string, unknown>): string {
  const path = input.path as string;
  if (!path || path === '.') {
    return 'current directory';
  }
  return path;
}