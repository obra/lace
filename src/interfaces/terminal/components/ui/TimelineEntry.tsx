// ABOUTME: Clean, unified timeline entry component with integrated markers and hint system
// ABOUTME: Replaces TimelineEntryCollapsibleBox and SideMarkerRenderer with single, consistent component

import React, { useEffect, useRef, useState } from 'react';
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
  const contentRef = useRef<any>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(1);
  const prevExpandedRef = useRef<boolean | undefined>(undefined);

  // Detect expansion state changes and trigger remeasurement
  useEffect(() => {
    const prevExpanded = prevExpandedRef.current;
    const currentExpanded = isExpanded;

    if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
      onToggle?.();
    }

    prevExpandedRef.current = currentExpanded;
  }, [isExpanded, onToggle]);

  // Measure content height for marker sizing
  useEffect(() => {
    if (isExpanded !== undefined) {
      setMeasuredHeight(1);
    }
    
    const measureAfterDOMUpdate = () => {
      if (contentRef.current && typeof contentRef.current === 'object' && 'nodeName' in contentRef.current) {
        try {
          const { height } = measureElement(contentRef.current as DOMElement);
          const newHeight = Math.max(1, height);
          setMeasuredHeight(newHeight);
        } catch (error) {
          setMeasuredHeight(1);
        }
      }
    };
    
    const timeoutId = setTimeout(measureAfterDOMUpdate, 1);
    return () => clearTimeout(timeoutId);
  }, [children, isExpanded]);

  // Calculate layout values
  const baseHeight = measuredHeight;
  const markers = getMarkerCharacters(baseHeight, isExpandable, isExpanded);
  const color = getMarkerColor(status, isSelected || isFocused);
  
  // Generate standard expand hint
  const expandHint = isSelected && isExpandable
    ? ` (${isExpanded 
        ? `${UI_SYMBOLS.ARROW_LEFT} to close`
        : `${UI_SYMBOLS.ARROW_RIGHT} to open`})`
    : '';

  // Content area
  const contentArea = (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          {typeof label === 'string' ? (
            <Text color="gray">{label}</Text>
          ) : (
            label
          )}
        </Box>
      )}

      <Box flexDirection="column" marginLeft={label ? 2 : 0}>
        <Box ref={contentRef}>
          {isExpanded ? children : (summary && summary)}
        </Box>
      </Box>
    </Box>
  );

  // Single line layout
  if (markers.single) {
    return (
      <Box marginBottom={1} flexDirection="column">
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
    <Box marginBottom={1} flexDirection="column">
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
      <Box flexDirection="row" marginLeft={2}>
        <Text color="gray">{expandHint}</Text>
      </Box>
    </Box>
  );
}