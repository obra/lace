// ABOUTME: Interactive collapsible content component for terminal interface
// ABOUTME: Supports keyboard navigation and customizable styling for event details

import React from 'react';
import { Box, Text } from 'ink';
import { UI_SYMBOLS } from '../../theme.js';

interface CollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  summary?: React.ReactNode; // Content to show when collapsed
  isExpanded: boolean; // Controlled state from parent
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round' | 'classic' | 'bold' | 'arrow';
  borderColor?: string;
  isSelected?: boolean; // Whether this specific box is selected (for visual indication)
  isFocused?: boolean; // Whether this box has keyboard focus (stronger visual indication)
}

export function CollapsibleBox({
  children,
  label,
  summary,
  isExpanded,
  maxHeight,
  borderStyle = 'round',
  borderColor = 'gray',
  isSelected = false,
  isFocused = false,
}: CollapsibleBoxProps) {
  // Determine visual styling based on focus and selection state
  const labelColor = isFocused ? 'yellow' : borderColor;
  const hintColor = isFocused ? 'yellow' : 'gray';
  const showHint = isSelected || isFocused;

  return (
    <Box flexDirection="column">
      {label && (
        <Box>
          <Text color={labelColor}>
            {isExpanded ? UI_SYMBOLS.EXPANDED : UI_SYMBOLS.COLLAPSED} {label}
          </Text>
          {isFocused && (
            <Text color="yellow">
              {' '}
              [FOCUSED - ESC to exit]
            </Text>
          )}
          {showHint && !isFocused && (
            <Text color={hintColor}>
              {' '}
              ({isExpanded 
                ? `${UI_SYMBOLS.ARROW_LEFT} to close`
                : `${UI_SYMBOLS.ARROW_RIGHT} to open | RETURN to focus`})
            </Text>
          )}
        </Box>
      )}

      {isExpanded ? (
        <Box flexDirection="column" marginLeft={2}>
          {children}
        </Box>
      ) : (
        summary && (
          <Box flexDirection="column" marginLeft={2}>
            {summary}
          </Box>
        )
      )}
    </Box>
  );
}
