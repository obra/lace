// ABOUTME: Specialized CollapsibleBox for timeline entries with consistent spacing
// ABOUTME: Provides standardized bottom padding for timeline event displays

import React, { useEffect, useRef } from 'react';
import { Box } from 'ink';
import { CollapsibleBox } from './CollapsibleBox.js';

interface TimelineEntryCollapsibleBoxProps {
  children: React.ReactNode;
  label?: string | React.ReactNode;
  summary?: React.ReactNode;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round';
  borderColor?: string;
  isSelected?: boolean;
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
  isSelected = false,
  isFocused = false,
  onToggle,
}: TimelineEntryCollapsibleBoxProps) {
  const prevExpandedRef = useRef<boolean | undefined>(undefined);

  // Detect expansion state changes and trigger remeasurement
  useEffect(() => {
    const prevExpanded = prevExpandedRef.current;
    const currentExpanded = isExpanded;

    // Only trigger on actual changes, not initial mount
    if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
      onToggle?.();
    }

    prevExpandedRef.current = currentExpanded;
  }, [isExpanded, onToggle]);

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
        isSelected={isSelected}
      />
    </Box>
  );
}
