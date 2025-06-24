// ABOUTME: Specialized CollapsibleBox for timeline entries with consistent spacing
// ABOUTME: Provides standardized bottom padding for timeline event displays

import React, { useCallback } from 'react';
import { Box, useInput } from 'ink';
import { CollapsibleBox } from './CollapsibleBox.js';

interface TimelineEntryCollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  summary?: React.ReactNode;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round';
  borderColor?: string;
  isFocused?: boolean;
  onToggle?: () => void; // Called when expanded/collapsed to trigger height re-measurement
}

export function TimelineEntryCollapsibleBox({ 
  children,
  label,
  summary,
  isExpanded,
  onExpandedChange,
  maxHeight,
  borderStyle,
  borderColor,
  isFocused = false,
  onToggle
}: TimelineEntryCollapsibleBoxProps) {
  
  // Handle left/right arrow expansion when focused
  useInput(useCallback((input, key) => {
    if (!isFocused) return;
    
    if (key.rightArrow) {
      onExpandedChange(true);
      onToggle?.(); // Notify parent of height change
    } else if (key.leftArrow) {
      onExpandedChange(false);
      onToggle?.(); // Notify parent of height change
    }
  }, [isFocused, onExpandedChange, onToggle]));
  
  return (
    <Box paddingBottom={1}>
      <CollapsibleBox 
        children={children}
        label={label}
        summary={summary}
        isExpanded={isExpanded}
        maxHeight={maxHeight}
        borderStyle={borderStyle}
        borderColor={borderColor}
        isFocused={isFocused}
      />
    </Box>
  );
}