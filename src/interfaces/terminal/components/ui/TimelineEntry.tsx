// ABOUTME: Clean, unified timeline entry component with integrated markers and hint system
// ABOUTME: Handles all timeline rendering with consistent expand/collapse behavior

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Text, measureElement, DOMElement } from 'ink';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';
import { useTimelineItemOptional } from '../events/contexts/TimelineItemContext.js';

export type TimelineStatus = 'none' | 'pending' | 'success' | 'error';

interface TimelineEntryProps {
  children: React.ReactNode;
  label?: string | React.ReactNode;
  summary?: React.ReactNode;
  isExpanded?: boolean;  // Optional - uses context if available
  onExpandedChange?: (expanded: boolean) => void;  // Optional - uses context if available
  isSelected?: boolean;  // Optional - uses context if available
  isFocused?: boolean;
  onToggle?: () => void;  // Optional - uses context if available
  status?: TimelineStatus;
  isExpandable?: boolean;
  isStreaming?: boolean;
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

function getStatusSymbol(status: TimelineStatus): string | null {
  const symbolMap = {
    none: null,
    pending: UI_SYMBOLS.PENDING,
    success: UI_SYMBOLS.SUCCESS,
    error: UI_SYMBOLS.ERROR,
  };
  return symbolMap[status];
}

function getStatusColor(status: TimelineStatus): string {
  const colorMap = {
    none: 'gray',
    pending: 'yellow',
    success: 'green', 
    error: 'red',
  };
  return colorMap[status];
}

export function TimelineEntry({
  children,
  label,
  summary,
  isExpanded: isExpandedProp,
  onExpandedChange: onExpandedChangeProp,
  isSelected: isSelectedProp,
  isFocused = false,
  onToggle: onToggleProp,
  status = 'none',
  isExpandable = false,
  isStreaming = false,
}: TimelineEntryProps) {
  const contentAreaRef = useRef<DOMElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(1);
  const prevExpandedRef = useRef<boolean | undefined>(undefined);
  const measureTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get context values if available
  const context = useTimelineItemOptional();
  
  // Use context values if available, otherwise fall back to props
  const isSelected = isSelectedProp ?? context?.isSelected ?? false;
  const isExpanded = isExpandedProp ?? context?.isExpanded ?? false;
  const onToggle = onToggleProp ?? context?.onToggle;
  const onExpandedChange = onExpandedChangeProp ?? 
    (context ? (expanded: boolean) => {
      if (expanded) {
        context.onExpand();
      } else {
        context.onCollapse();
      }
    } : undefined);

  // Debounced height measurement function
  const measureHeight = useCallback(() => {
    // Clear any existing timeout
    if (measureTimeoutRef.current) {
      clearTimeout(measureTimeoutRef.current);
    }
    
    // Debounce the measurement to avoid excessive calls
    measureTimeoutRef.current = setTimeout(() => {
      if (contentAreaRef.current) {
        try {
          const { height } = measureElement(contentAreaRef.current);
          const newHeight = Math.max(1, height);
          setMeasuredHeight(prev => prev !== newHeight ? newHeight : prev);
        } catch (error) {
          // Log error for debugging but fallback gracefully
          console.warn('TimelineEntry: Failed to measure height', error);
          setMeasuredHeight(prev => prev !== 1 ? 1 : prev);
        }
      }
    }, 16); // ~60fps debounce
  }, []);

  // Detect expansion state changes and trigger remeasurement
  useEffect(() => {
    const prevExpanded = prevExpandedRef.current;
    const currentExpanded = isExpanded;

    if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
      onToggle?.();
      
      // Clear any pending measurements
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
      
      // For collapse, measure immediately to update timeline height quickly
      // For expand, use a short delay to let content render
      if (!currentExpanded) {
        // Collapsing - measure immediately
        measureHeight();
      } else {
        // Expanding - small delay for content to render
        measureTimeoutRef.current = setTimeout(measureHeight, 50);
      }
    }

    prevExpandedRef.current = currentExpanded;
  }, [isExpanded, onToggle, measureHeight]);

  // Measure content height when children change (debounced)
  useEffect(() => {
    if (measureTimeoutRef.current) {
      clearTimeout(measureTimeoutRef.current);
    }
    // Use shorter delay for streaming content to make side indicators more responsive
    const delay = isStreaming ? 10 : 100;
    measureTimeoutRef.current = setTimeout(measureHeight, delay);
    
    return () => {
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
    };
  }, [children, measureHeight, isStreaming]);

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

  // Get status symbol and color
  const statusSymbol = getStatusSymbol(status);
  const statusColor = getStatusColor(status);

  // Content area - simplified to reduce empty space
  const actualContent = isExpanded ? children : (summary && summary);
  
  const contentArea = (
    <Box ref={contentAreaRef} marginBottom={0} flexDirection="column">
      {label && (
        <Box marginBottom={0} flexDirection="row">
          {statusSymbol && (
            <React.Fragment>
              <Text color={statusColor}>{statusSymbol} </Text>
            </React.Fragment>
          )}
          {typeof label === 'string' ? (
            <Text color="gray">{label}</Text>
          ) : (
            label
          )}
        </Box>
      )}
      {actualContent && (
        <Box marginLeft={label ? 2 : 0}>
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
    </Box>
  );
}
