// ABOUTME: Specialized CollapsibleBox for timeline entries with consistent spacing
// ABOUTME: Provides standardized bottom padding for timeline event displays

import React, { useCallback } from 'react';
import { Box, useInput, useFocus } from 'ink';
import { CollapsibleBox } from './CollapsibleBox.js';

interface TimelineEntryCollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  summary?: React.ReactNode;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  maxHeight?: number;
  expandedBorderStyle?: 'single' | 'double' | 'round';
  expandedBorderColor?: string;
  focusId?: string; // Unique focus ID for this component
  onToggle?: () => void; // Called when expanded/collapsed to trigger height re-measurement
  onEscape?: () => void; // Called when escape key is pressed
}

export function TimelineEntryCollapsibleBox({ 
  children,
  label,
  summary,
  isExpanded,
  onExpandedChange,
  maxHeight,
  expandedBorderStyle,
  expandedBorderColor,
  focusId,
  onToggle,
  onEscape
}: TimelineEntryCollapsibleBoxProps) {
  
  // Get focus state using the focus hook
  const { isFocused } = useFocus({ id: focusId });
  
  // Handle keyboard input when focused
  useInput(useCallback((input, key) => {
    if (!isFocused) return;
    
    if (key.escape) {
      onEscape?.();
    } else if (key.rightArrow) {
      onExpandedChange(true);
      onToggle?.(); // Notify parent of height change
    } else if (key.leftArrow) {
      onExpandedChange(false);
      onToggle?.(); // Notify parent of height change
    }
  }, [isFocused, onExpandedChange, onToggle, onEscape]));
  
  return (
    <Box paddingBottom={1}>
      <CollapsibleBox 
        children={children}
        label={label}
        summary={summary}
        isExpanded={isExpanded}
        maxHeight={maxHeight}
        expandedBorderStyle={expandedBorderStyle}
        expandedBorderColor={expandedBorderColor}
        isFocused={isFocused}
      />
    </Box>
  );
}
