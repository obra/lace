// ABOUTME: Clean, unified timeline entry component with integrated markers and hint system
// ABOUTME: Handles all timeline rendering with consistent expand/collapse behavior

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Text, measureElement, DOMElement } from 'ink';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

export type TimelineStatus = 'none' | 'pending' | 'success' | 'error';

interface TimelineEntryProps {
  children: React.ReactNode;
  label?: string | React.ReactNode;
  summary?: React.ReactNode;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  isSelected?: boolean;
  isFocused?: boolean;
  onToggle?: () => void;
  status?: TimelineStatus;
  isExpandable?: boolean;
}

function getMarkerCharacters(height: number, isExpandable: boolean = false, isExpanded: boolean = false): {
  top?: string;
  middle?: string;
  bottom?: string;
  single?: string;
} {
  if (height === 1) {
    return { single: isExpandable ? UI_SYMBOLS.TOOLBOX_SINGLE_EXPANDABLE : UI_SYMBOLS.TOOLBOX_SINGLE };
  } else if (height === 2) {
    return { 
      top: (isExpandable && !isExpanded) ? UI_SYMBOLS.TOOLBOX_TOP_EXPANDABLE : UI_SYMBOLS.TOOLBOX_TOP, 
      bottom: UI_SYMBOLS.TOOLBOX_BOTTOM 
    };
  } else {
    return {
      top: (isExpandable && !isExpanded) ? UI_SYMBOLS.TOOLBOX_TOP_EXPANDABLE : UI_SYMBOLS.TOOLBOX_TOP,
      middle: UI_SYMBOLS.TOOLBOX_MIDDLE,
      bottom: UI_SYMBOLS.TOOLBOX_BOTTOM
    };
  }
}

function getMarkerColor(status: TimelineStatus, isSelected: boolean): string {
  const colorMap = {
    none: isSelected ? UI_COLORS.TOOLBOX_NONE_BRIGHT : UI_COLORS.TOOLBOX_NONE,
    pending: isSelected ? UI_COLORS.TOOLBOX_PENDING_BRIGHT : UI_COLORS.TOOLBOX_PENDING,
    success: isSelected ? UI_COLORS.TOOLBOX_SUCCESS_BRIGHT : UI_COLORS.TOOLBOX_SUCCESS,
    error: isSelected ? UI_COLORS.TOOLBOX_ERROR_BRIGHT : UI_COLORS.TOOLBOX_ERROR,
  };
  return colorMap[status];
}

export function TimelineEntry({
  children,
  label,
  summary,
  isExpanded,
  onExpandedChange,
  isSelected = false,
  isFocused = false,
  onToggle,
  status = 'none',
  isExpandable = false,
}: TimelineEntryProps) {
  const contentRef = useRef<DOMElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(1);
  const prevExpandedRef = useRef<boolean | undefined>(undefined);
  const measureTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced height measurement function
  const measureHeight = useCallback(() => {
    if (contentRef.current) {
      try {
        const { height } = measureElement(contentRef.current);
        const newHeight = Math.max(1, height);
        setMeasuredHeight(prev => prev !== newHeight ? newHeight : prev);
      } catch (error) {
        setMeasuredHeight(prev => prev !== 1 ? 1 : prev);
      }
    }
  }, []);

  // Detect expansion state changes and trigger remeasurement
  useEffect(() => {
    const prevExpanded = prevExpandedRef.current;
    const currentExpanded = isExpanded;

    if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
      onToggle?.();
      // Schedule measurement after expansion change
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
      measureTimeoutRef.current = setTimeout(measureHeight, 50);
    }

    prevExpandedRef.current = currentExpanded;
  }, [isExpanded, onToggle, measureHeight]);

  // Measure content height when children change (debounced)
  useEffect(() => {
    if (measureTimeoutRef.current) {
      clearTimeout(measureTimeoutRef.current);
    }
    measureTimeoutRef.current = setTimeout(measureHeight, 100);
    
    return () => {
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
    };
  }, [children, measureHeight]);

  // Calculate layout values - force minimum 2 lines for expandable items
  const baseHeight = isExpandable ? Math.max(2, measuredHeight) : measuredHeight;
  const markers = getMarkerCharacters(baseHeight, isExpandable, isExpanded);
  const color = getMarkerColor(status, isSelected || isFocused);
  
  // Generate standard expand hint
  const expandHint = isSelected && isExpandable
    ? ` (${isExpanded 
        ? `${UI_SYMBOLS.ARROW_LEFT} to close`
        : `${UI_SYMBOLS.ARROW_RIGHT} to open`})`
    : ' ';

  // Content area - simplified to reduce empty space
  const actualContent = isExpanded ? children : (summary && summary);
  
  const contentArea = (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={0}>
          {typeof label === 'string' ? (
            <Text color="gray">{label}</Text>
          ) : (
            label
          )}
        </Box>
      )}
      {actualContent && (
        <Box ref={contentRef} marginLeft={label ? 2 : 0}>
          {actualContent}
        </Box>
      )}
      <Box marginLeft={label ? 2 : 0}>
        <Text color="gray">{expandHint}</Text>
      </Box>
    </Box>
  );

  // Single line layout - but force multi-line for expandable items
  if (markers.single && !isExpandable) {
    return (
      <Box marginBottom={0} flexDirection="column">
        <Box flexDirection="row">
          <Text color={color}>{markers.single} </Text>
          <Box flexDirection="column" flexGrow={1}>
            {contentArea}
          </Box>
        </Box>
        <Box flexDirection="row" marginLeft={2}>
          <Text color="gray">{expandHint}</Text>
        </Box>
      </Box>
    );
  }

  // Multi-line layout
  const middleCount = Math.max(0, baseHeight - 2);
  
  return (
    <Box marginBottom={0} flexDirection="column">
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={1}>
          <Text color={color}>{markers.top}</Text>
          {Array.from({ length: middleCount }, (_, i) => (
            <Text key={i} color={color}>{markers.middle}</Text>
          ))}
          <Text color={color}>{markers.bottom}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {contentArea}
        </Box>
      </Box>
    </Box>
  );
}
