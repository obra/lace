// ABOUTME: Clean, unified timeline entry component with integrated markers and hint system
// ABOUTME: Handles all timeline rendering with consistent expand/collapse behavior

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Text, measureElement, DOMElement } from 'ink';
import { UI_SYMBOLS, UI_BACKGROUNDS } from '~/interfaces/terminal/theme.js';
import { useTimelineItemOptional } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';

export type TimelineStatus = 'none' | 'pending' | 'success' | 'error';
export type TimelineMessageType = 'tool' | 'agent' | 'user' | 'none';

interface TimelineEntryProps {
  children: React.ReactNode;
  label?: string | React.ReactNode;
  summary?: React.ReactNode;
  isExpanded?: boolean; // Optional - uses context if available
  onExpandedChange?: (expanded: boolean) => void; // Optional - uses context if available
  isSelected?: boolean; // Optional - uses context if available
  isFocused?: boolean;
  onToggle?: () => void; // Optional - uses context if available
  status?: TimelineStatus;
  messageType?: TimelineMessageType;
  isExpandable?: boolean;
  isStreaming?: boolean;
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

function getBackgroundColor(
  status: TimelineStatus,
  messageType: TimelineMessageType,
  isSelected: boolean
): string {
  if (isSelected) {
    return UI_BACKGROUNDS.TIMELINE_SELECTED;
  }

  // Message type takes precedence over status for background color
  const messageTypeColorMap = {
    tool: UI_BACKGROUNDS.TIMELINE_TOOL,
    agent: UI_BACKGROUNDS.TIMELINE_AGENT,
    user: UI_BACKGROUNDS.TIMELINE_USER,
    none: null, // Fall back to status-based colors
  };

  const messageTypeColor = messageTypeColorMap[messageType];
  if (messageTypeColor !== null) {
    return messageTypeColor;
  }

  // Fall back to status-based colors
  const statusColorMap = {
    none: UI_BACKGROUNDS.TIMELINE_NONE,
    pending: UI_BACKGROUNDS.TIMELINE_PENDING,
    success: UI_BACKGROUNDS.TIMELINE_SUCCESS,
    error: UI_BACKGROUNDS.TIMELINE_ERROR,
  };
  return statusColorMap[status];
}

function getExpansionIndicator(isExpandable: boolean, isExpanded: boolean): string {
  if (!isExpandable) return '';
  return isExpanded ? UI_SYMBOLS.EXPANDED : UI_SYMBOLS.COLLAPSED;
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
  messageType = 'none',
  isExpandable = false,
  isStreaming = false,
}: TimelineEntryProps) {
  const contentAreaRef = useRef<DOMElement | null>(null);
  const [_measuredHeight, setMeasuredHeight] = useState<number>(1);
  const prevExpandedRef = useRef<boolean | undefined>(undefined);
  const measureTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get context values if available
  const context = useTimelineItemOptional();

  // Use context values if available, otherwise fall back to props
  const isSelected = isSelectedProp ?? context?.isSelected ?? false;
  const isExpanded = isExpandedProp ?? context?.isExpanded ?? false;
  const onToggle = onToggleProp ?? context?.onToggle;
  const _onExpandedChange =
    onExpandedChangeProp ??
    (context
      ? (expanded: boolean) => {
          if (expanded) {
            context.onExpand();
          } else {
            context.onCollapse();
          }
        }
      : undefined);

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
          setMeasuredHeight((prev) => (prev !== newHeight ? newHeight : prev));
        } catch (error) {
          // Log error for debugging but fallback gracefully
          console.warn('TimelineEntry: Failed to measure height', error);
          setMeasuredHeight((prev) => (prev !== 1 ? 1 : prev));
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

  // Get background color and expansion indicator
  const backgroundColor = getBackgroundColor(status, messageType, isSelected || isFocused);
  const expansionIndicator = getExpansionIndicator(isExpandable, isExpanded);

  // Generate standard expand hint
  const expandHint =
    isSelected && isExpandable
      ? ` (${
          isExpanded ? `${UI_SYMBOLS.ARROW_LEFT} to close` : `${UI_SYMBOLS.ARROW_RIGHT} to open`
        })`
      : ' ';

  // Get status symbol and color
  const statusSymbol = getStatusSymbol(status);
  const statusColor = getStatusColor(status);

  // Content area - simplified to reduce empty space
  const actualContent = isExpanded ? children : summary && summary;

  return (
    <Box marginBottom={1} marginLeft={1} marginRight={1} flexDirection="column">
      <Box
        backgroundColor={backgroundColor}
        width="100%"
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
      >
        <Box ref={contentAreaRef} flexDirection="column">
          {/* Top row with expansion indicator and label */}
          <Box flexDirection="row" alignItems="flex-start">
            {/* Top left corner expansion indicator */}
            {expansionIndicator && (
              <Box marginRight={1}>
                <Text color={isSelected ? 'white' : 'gray'}>{expansionIndicator}</Text>
              </Box>
            )}

            {/* Status symbol and label */}
            {label && (
              <Box flexDirection="row" flexGrow={1}>
                {statusSymbol && (
                  <React.Fragment>
                    <Text color={statusColor}>{statusSymbol} </Text>
                  </React.Fragment>
                )}
                {typeof label === 'string' ? (
                  <Text color={isSelected ? 'white' : 'gray'}>{label}</Text>
                ) : (
                  label
                )}
              </Box>
            )}
          </Box>

          {/* Content area */}
          {actualContent && (
            <Box marginLeft={expansionIndicator ? 2 : 0} marginTop={label ? 0 : 0}>
              {actualContent}
            </Box>
          )}

          {/* Expand hint - always show for consistent spacing */}
          <Box marginLeft={expansionIndicator ? 2 : 0} marginTop={0}>
            <Text color="gray">{isExpandable ? (isSelected ? expandHint : ' ') : ' '}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
