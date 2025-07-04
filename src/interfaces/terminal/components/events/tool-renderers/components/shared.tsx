// ABOUTME: Minimal shared components for tool renderers - header, preview, content, and expansion hook
// ABOUTME: Provides simple, focused components that tool renderers compose directly

import React from 'react';
import { Box, Text } from 'ink';
import { useTimelineItemExpansion } from '../../hooks/useTimelineExpansionToggle.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';

// Standard props interface for all tool renderers
export interface ToolRendererProps {
  item: {
    type: 'tool_execution';
    call: ToolCall;
    result?: ToolResult;
    timestamp: Date;
    callId: string;
  };
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

interface ToolHeaderProps {
  icon?: string;
  status?: 'pending' | 'success' | 'error';
  children: React.ReactNode;
}

// Standard header with icon, title, and status indicator
export function ToolHeader({ 
  icon = '🔧', 
  status,
  children 
}: ToolHeaderProps) {
  const statusIcon = status === 'pending' ? '⏳' : status === 'success' ? '✓' : status === 'error' ? '✗' : '';
  const statusColor = status === 'pending' ? 'gray' : status === 'success' ? 'green' : status === 'error' ? 'red' : 'gray';
  
  return (
    <Box>
      <Text color="yellow">{icon} </Text>
      {children}
      {status && (
        <>
          <Text color="gray"> </Text>
          <Text color={statusColor}>{statusIcon}</Text>
        </>
      )}
    </Box>
  );
}

interface ToolPreviewProps {
  children: React.ReactNode;
}

// Collapsed preview styling
export function ToolPreview({ children }: ToolPreviewProps) {
  return (
    <Box marginLeft={2} marginTop={1}>
      {children}
    </Box>
  );
}

interface ToolContentProps {
  children: React.ReactNode;
}

// Expanded content container
export function ToolContent({ children }: ToolContentProps) {
  return (
    <Box marginLeft={2} marginTop={1} flexDirection="column">
      {children}
    </Box>
  );
}

// The ONLY shared hook - for expansion state
export function useToolExpansion(isSelected: boolean, onToggle?: () => void) {
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected, onToggle);
  
  return {
    isExpanded,
    toggle: () => isExpanded ? onCollapse() : onExpand()
  };
}

// Simple utility to limit lines for preview
export function limitLines(text: string, maxLines: number): { 
  lines: string[], 
  truncated: boolean,
  remaining: number 
} {
  if (!text) return { lines: [], truncated: false, remaining: 0 };
  
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { lines, truncated: false, remaining: 0 };
  }
  
  return { 
    lines: lines.slice(0, maxLines), 
    truncated: true,
    remaining: lines.length - maxLines
  };
}