// ABOUTME: Specialized CollapsibleBox for timeline entries with consistent spacing
// ABOUTME: Provides standardized bottom padding for timeline event displays

import React from 'react';
import { Box } from 'ink';
import { CollapsibleBox } from './CollapsibleBox.js';

interface TimelineEntryCollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  summary?: React.ReactNode;
  defaultExpanded?: boolean;
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round';
  borderColor?: string;
  isFocused?: boolean;
  onToggle?: () => void;
}

export function TimelineEntryCollapsibleBox(props: TimelineEntryCollapsibleBoxProps) {
  return (
    <Box paddingBottom={1}>
      <CollapsibleBox {...props} />
    </Box>
  );
}