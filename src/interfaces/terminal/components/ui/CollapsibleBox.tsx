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
  expandedBorderStyle?: 'single' | 'double' | 'round' | 'classic' | 'bold' | 'arrow';
  expandedBorderColor?: string;
  isFocused?: boolean; // Whether this specific box is focused (for visual indication)
}

export function CollapsibleBox({ 
  children, 
  label, 
  summary,
  isExpanded,
  maxHeight,
  expandedBorderStyle = 'round',
  expandedBorderColor = 'gray',
  isFocused = false
}: CollapsibleBoxProps) {
  
  return (
    <Box flexDirection="column">
      {label && (
        <Box>
          <Text color={expandedBorderColor}>
            {isExpanded ? UI_SYMBOLS.EXPANDED : UI_SYMBOLS.COLLAPSED} {label}
          </Text>
          {isFocused && (
		isExpanded ? 
            <Text color="gray"> ({UI_SYMBOLS.ARROW_LEFT} to close)</Text>
		:
            <Text color="gray"> ({UI_SYMBOLS.ARROW_RIGHT} to open)</Text>
		
          )}
        </Box>
      )}
      
      {isExpanded ? (
        <Box 
          flexDirection="column"
	  borderStyle={expandedBorderStyle}
          borderColor={expandedBorderColor}
          marginLeft={2}
        >
          {children}
        </Box>
      ) : (
        summary && (
          <Box 
            flexDirection="column"
            marginLeft={2}
          >
            {summary}
          </Box>
        )
      )}
    </Box>
  );
}
