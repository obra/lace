// ABOUTME: Wrapper component that adds cursor display and dimming to timeline items
// ABOUTME: Handles line-by-line cursor positioning and focus state without modifying each display component

import React from 'react';
import { Box, Text } from 'ink';

interface CursorWrapperProps {
  children: React.ReactNode;
  isFocused?: boolean;
  focusedLine?: number;
  itemStartLine?: number;
  itemHeight?: number;
}

export function CursorWrapper({ children, isFocused, focusedLine, itemStartLine }: CursorWrapperProps) {
  // Show cursor if the focused line is the first line of this item
  // (This is a simplified approach - we'll need to handle multi-line items differently)
  const showCursor = focusedLine !== undefined && itemStartLine !== undefined && focusedLine === itemStartLine;

  return (
    <Box flexDirection="row">
      {/* Cursor display */}
      <Text color={showCursor ? "cyan" : "transparent"}>
        {showCursor ? '█' : ' '}
      </Text>
      
      {/* Content without any left/right padding */}
      <Box flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}