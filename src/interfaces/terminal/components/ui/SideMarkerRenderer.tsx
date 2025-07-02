// ABOUTME: Custom side marker renderer for timeline entries with status-based colors
// ABOUTME: Replaces full borders with left-side character markers showing tool execution status

import React, { useRef, useEffect, useState } from 'react';
import { Box, Text, measureElement, DOMElement } from 'ink';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

export type MarkerStatus = 'none' | 'pending' | 'success' | 'error';

interface SideMarkerRendererProps {
  status: MarkerStatus;
  isSelected: boolean;
  contentHeight?: number; // Optional override for content height
  isExpanded?: boolean; // Whether the content is expanded (for measurement timing)
  isExpandable?: boolean; // Whether the content can be expanded (affects marker symbols)
  children: React.ReactNode;
}

export function getMarkerCharacters(height: number, isExpandable: boolean = false, isExpanded: boolean = false): {
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

export function getMarkerColor(status: MarkerStatus, isSelected: boolean): string {
  const colorMap = {
    none: isSelected ? UI_COLORS.TOOLBOX_NONE_BRIGHT : UI_COLORS.TOOLBOX_NONE,
    pending: isSelected ? UI_COLORS.TOOLBOX_PENDING_BRIGHT : UI_COLORS.TOOLBOX_PENDING,
    success: isSelected ? UI_COLORS.TOOLBOX_SUCCESS_BRIGHT : UI_COLORS.TOOLBOX_SUCCESS,
    error: isSelected ? UI_COLORS.TOOLBOX_ERROR_BRIGHT : UI_COLORS.TOOLBOX_ERROR,
  };
  return colorMap[status];
}

export function SideMarkerRenderer({ 
  status, 
  isSelected, 
  contentHeight: providedHeight, 
  isExpanded,
  isExpandable = false,
  children 
}: SideMarkerRendererProps) {
  const contentRef = useRef<any>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(1);
  
  // Measure the actual rendered content height when needed
  useEffect(() => {
    // Only measure if no explicit height was provided
    if (providedHeight !== undefined) {
      return;
    }
    
    // Reset to default when expansion state changes
    if (isExpanded !== undefined) {
      setMeasuredHeight(1);
    }
    
    // Defer measurement to ensure DOM has updated after expansion/collapse
    const measureAfterDOMUpdate = () => {
      if (contentRef.current && typeof contentRef.current === 'object' && 'nodeName' in contentRef.current) {
        try {
          const { height } = measureElement(contentRef.current as DOMElement);
          const newHeight = Math.max(1, height);
          setMeasuredHeight(newHeight);
        } catch (error) {
          // Fallback to single line if measurement fails
          setMeasuredHeight(1);
        }
      }
    };
    
    // Use setTimeout to defer measurement until after DOM updates
    // This ensures CollapsibleBox has re-rendered its content
    const timeoutId = setTimeout(measureAfterDOMUpdate, 1);
    
    return () => clearTimeout(timeoutId);
  }, [children, providedHeight, isExpanded]);
  
  // Use provided height if available, otherwise use measured height
  const actualHeight = providedHeight ?? measuredHeight;
  const markers = getMarkerCharacters(actualHeight, isExpandable, isExpanded);
  const color = getMarkerColor(status, isSelected);
  
  if (markers.single) {
    // Single line layout
    return (
      <Box flexDirection="row">
        <Text color={color}>{markers.single} </Text>
        <Box flexDirection="column" flexGrow={1}>
          <Box ref={contentRef}>
            {children}
          </Box>
        </Box>
      </Box>
    );
  }
  
  // Multi-line layout with positioned markers
  const middleCount = Math.max(0, actualHeight - 2);
  
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" marginRight={1}>
        <Text color={color}>{markers.top}</Text>
        {Array.from({ length: middleCount }, (_, i) => (
          <Text key={i} color={color}>{markers.middle}</Text>
        ))}
        <Text color={color}>{markers.bottom}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box ref={contentRef}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}