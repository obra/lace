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
}

export function CollapsibleBox({ 
  children, 
  label, 
  summary,
  isExpanded,
  maxHeight,
  borderStyle = 'round',
  borderColor = 'gray',
  isSelected = false
}: CollapsibleBoxProps) {
  
  return (
    <Box flexDirection="column">
      {label && (
        <Box>
          <Text color={borderColor}>
            {isExpanded ? UI_SYMBOLS.EXPANDED : UI_SYMBOLS.COLLAPSED} {label}
          </Text>
          {isSelected && (
            <Text color="gray"> ({UI_SYMBOLS.ARROW_LEFT} {UI_SYMBOLS.ARROW_RIGHT} to toggle)</Text>
          )}
        </Box>
      )}
      
      {isExpanded ? (
        <Box 
          flexDirection="column"
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
