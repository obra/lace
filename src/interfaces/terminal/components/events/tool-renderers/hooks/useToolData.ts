// ABOUTME: Data processing layer for tool execution items - extracts and parses tool-specific information
// ABOUTME: Provides consistent data structures across all tools with tool-specific parsing logic

import { useMemo } from 'react';
import { ToolCall, ToolResult } from '../../../../../../tools/types.js';
import { UI_SYMBOLS } from '../../../../theme.js';

// Tool execution item type
export type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

// Standardized tool data structure
export interface ToolData {
  // Basic info
  toolName: string;
  primaryInfo: string;
  secondaryInfo: string;

  // Status
  success: boolean;
  isStreaming: boolean;
  statusIcon: string;

  // Content
  output: string;
  language: string;
  isEmpty?: boolean;
  stats?: string;

  // Raw data for custom processing
  input: Record<string, unknown>;
  result?: ToolResult;
}

// Helper function to detect JSON content
function detectLanguage(content: string): string {
  if (!content || typeof content !== 'string') return 'text';

  const trimmed = content.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return 'json';
  }

  return 'text';
}

// Helper function to parse file write results
function parseFileWriteResult(output: string): { characterCount: number; filePath: string } | null {
  const pattern = /Successfully wrote (\d+) characters to (.+)/;
  const match = output.match(pattern);

  if (match) {
    return {
      characterCount: parseInt(match[1], 10),
      filePath: match[2],
    };
  }

  return null;
}

// Helper function to format character count
function formatCharacterCount(count: number): string {
  if (count === 0) return '0 characters';
  if (count === 1) return '1 character';

  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M characters`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K characters`;
  }

  return `${count} characters`;
}

// Helper function to parse search results
function parseSearchResults(output: string): { files: number; matches: number; isEmpty: boolean } {
  if (output === 'No matches found') {
    return { files: 0, matches: 0, isEmpty: true };
  }

  // Parse "Found X match(es)" pattern
  const matchPattern = /Found (\d+) match(?:es)?/;
  const match = output.match(matchPattern);
  const totalMatches = match ? parseInt(match[1], 10) : 0;

  // Count unique files by counting lines that don't start with whitespace and contain ":"
  const lines = output.split('\n');
  const fileLines = lines.filter(
    (line) =>
      line.trim().length > 0 &&
      !line.startsWith(' ') &&
      !line.startsWith('\t') &&
      line.includes(':') &&
      !line.startsWith('Found')
  );

  return {
    files: fileLines.length,
    matches: totalMatches,
    isEmpty: totalMatches === 0,
  };
}

// Helper function to get search parameters summary
function getSearchParameters(input: Record<string, unknown>): string {
  const parts: string[] = [];

  if (input.caseSensitive) parts.push('case-sensitive');
  if (input.wholeWord) parts.push('whole words');
  if (input.includePattern) parts.push(`include: ${input.includePattern}`);
  if (input.excludePattern) parts.push(`exclude: ${input.excludePattern}`);
  if (input.contextLines && input.contextLines !== 0) parts.push(`context: ${input.contextLines}`);

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

// Helper function to get search path display
function getSearchPath(input: Record<string, unknown>): string {
  const path = input.path as string;
  if (!path || path === '.') {
    return 'current directory';
  }
  return path;
}

// Helper function to parse edit result
function parseEditResult(
  output: string
): { filePath: string; fromLines: number; toLines: number } | null {
  const pattern = /Successfully replaced text in (.+) \((\d+) lines → (\d+) lines\)/;
  const match = output.match(pattern);

  if (match) {
    return {
      filePath: match[1],
      fromLines: parseInt(match[2], 10),
      toLines: parseInt(match[3], 10),
    };
  }

  return null;
}

// Main hook for extracting tool data
export function useToolData(item: ToolExecutionItem): ToolData {
  return useMemo(() => {
    const { call, result } = item;
    const { name: toolName, arguments: input } = call;

    // Basic status
    const success = result ? !result.isError : true;
    const isStreaming = !result;
    const output = result?.content?.[0]?.text || '';
    const statusIcon = success
      ? UI_SYMBOLS.SUCCESS
      : result
        ? UI_SYMBOLS.ERROR
        : UI_SYMBOLS.PENDING;

    // Tool-specific data extraction
    let primaryInfo = '';
    let secondaryInfo = '';
    let stats = '';
    let isEmpty = false;

    switch (toolName) {
      case 'bash':
        primaryInfo = `$ ${(input.command as string) || ''}`;
        secondaryInfo = (input.description as string) || '';
        break;

      case 'file-write':
        primaryInfo = (input.path as string) || '';
        if (result && success) {
          const writeResult = parseFileWriteResult(output);
          if (writeResult) {
            stats = formatCharacterCount(writeResult.characterCount);
          }
        }
        break;

      case 'ripgrep-search':
        {
          const pattern = (input.pattern as string) || '';
          const searchPath = getSearchPath(input);
          primaryInfo = `"${pattern}" in ${searchPath}`;
          secondaryInfo = getSearchParameters(input);

          if (result && success) {
            const searchStats = parseSearchResults(output);
            isEmpty = searchStats.isEmpty;
            stats = searchStats.isEmpty
              ? 'No matches found'
              : `${searchStats.matches} matches across ${searchStats.files} files`;
          }
        }
        break;

      case 'file-edit':
        primaryInfo = (input.path as string) || '';
        if (result && success) {
          const editResult = parseEditResult(output);
          if (editResult) {
            stats = `1 replacement (${editResult.fromLines} → ${editResult.toLines} lines)`;
          }
        }
        break;

      case 'file-list':
        {
          const path = input.path as string;
          primaryInfo = !path || path === '.' ? 'current directory' : path;

          const parts: string[] = [];
          if (input.recursive) parts.push('recursive');
          if (input.includeHidden) parts.push('hidden files');
          if (input.pattern) parts.push(`pattern: ${input.pattern}`);
          if (input.maxDepth && input.maxDepth !== 3) parts.push(`depth: ${input.maxDepth}`);

          secondaryInfo = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        }
        break;

      case 'delegate':
        {
          const task = ((input.task || input.prompt) as string) || 'Unknown task';
          primaryInfo = `"${task}"`;
          secondaryInfo = '[DELEGATE]';
        }
        break;

      default:
        // Generic fallback
        primaryInfo = toolName;
        break;
    }

    return {
      toolName,
      primaryInfo,
      secondaryInfo,
      success,
      isStreaming,
      statusIcon,
      output,
      language: detectLanguage(output),
      isEmpty,
      stats,
      input,
      result,
    };
  }, [item]);
}
