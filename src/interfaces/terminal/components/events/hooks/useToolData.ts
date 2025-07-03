// ABOUTME: Data processing hook for extracting and parsing tool execution information
// ABOUTME: Provides structured data from tool inputs and outputs with consistent patterns across all tools

import { useMemo } from 'react';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { UI_SYMBOLS } from '../../../theme.js';

// Extract tool execution timeline item type
export type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

// Structured tool data with consistent patterns
export interface ToolData {
  // Basic tool information
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  isStreaming: boolean;
  
  // Tool-specific primary information (command, file path, etc.)
  primaryInfo: string;
  secondaryInfo?: string;
  
  // Status indicators
  statusIcon: string;
  markerStatus: 'pending' | 'success' | 'error' | 'none';
  
  // Content detection
  isJsonOutput: boolean;
  detectedLanguage?: string;
}

/**
 * Hook for extracting and parsing tool execution data
 * 
 * This hook provides consistent data extraction patterns across all tools,
 * eliminating the need for each tool renderer to implement its own parsing logic.
 * 
 * @param item - Tool execution item from timeline
 * @returns Structured tool data with consistent patterns
 */
export function useToolData(item: ToolExecutionItem): ToolData {
  return useMemo(() => {
    const { call, result } = item;
    const { name: toolName, arguments: input } = call;
    
    // Parse basic output information
    const success = result ? !result.isError : true;
    const output = result?.content?.[0]?.text || '';
    const isStreaming = !result;
    
    // Create status indicators
    const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;
    const markerStatus = isStreaming ? 'pending' : success ? 'success' : result ? 'error' : 'none';
    
    // Tool-specific primary information extraction
    const primaryInfo = extractPrimaryInfo(toolName, input);
    const secondaryInfo = extractSecondaryInfo(toolName, input);
    
    // Content analysis
    const isJsonOutput = detectJsonOutput(output);
    const detectedLanguage = detectLanguage(toolName, input, output);
    
    return {
      toolName,
      input,
      output,
      success,
      isStreaming,
      primaryInfo,
      secondaryInfo,
      statusIcon,
      markerStatus,
      isJsonOutput,
      detectedLanguage,
    };
  }, [item]);
}

/**
 * Extract primary display information for a tool
 * This is the main identifier shown in the tool header
 */
function extractPrimaryInfo(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash':
      return `$ ${input.command || ''}`;
    
    case 'file-read':
    case 'file-write':
    case 'file-edit':
    case 'file-list':
      return String(input.path || input.directory || '');
    
    case 'file-search':
    case 'ripgrep-search':
      return `"${input.pattern || input.query || ''}"`;
    
    case 'delegate':
      return `"${input.task || input.prompt || ''}"`;
    
    case 'url-fetch':
      return String(input.url || '');
    
    case 'task-manager':
      return String(input.action || '');
    
    default:
      // Generic fallback - use first string argument
      const firstStringValue = Object.values(input).find(v => typeof v === 'string');
      return String(firstStringValue || toolName);
  }
}

/**
 * Extract secondary display information for a tool
 * This provides additional context in the tool header
 */
function extractSecondaryInfo(toolName: string, input: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'bash':
      return input.description ? ` (${input.description})` : undefined;
    
    case 'file-list':
      return input.pattern ? ` matching "${input.pattern}"` : undefined;
    
    case 'file-search':
    case 'ripgrep-search':
      return input.path ? ` in ${input.path}` : undefined;
    
    case 'delegate':
      return ' [DELEGATE]';
    
    default:
      return undefined;
  }
}

/**
 * Detect if output is JSON format
 */
function detectJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;
  
  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

/**
 * Detect the language/format of tool output for syntax highlighting
 */
function detectLanguage(toolName: string, input: Record<string, unknown>, output: string): string | undefined {
  // Language detection based on tool type
  switch (toolName) {
    case 'bash':
      return 'text'; // Bash output is usually plain text
    
    case 'file-read':
    case 'file-write':
    case 'file-edit':
      // Detect language from file extension
      const filePath = String(input.path || '');
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
      if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
      if (filePath.endsWith('.py')) return 'python';
      if (filePath.endsWith('.md')) return 'markdown';
      if (filePath.endsWith('.json')) return 'json';
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml';
      if (filePath.endsWith('.sh')) return 'bash';
      return 'text';
    
    default:
      // Auto-detect based on output content
      if (detectJsonOutput(output)) return 'json';
      return 'text';
  }
}