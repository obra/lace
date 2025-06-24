// ABOUTME: Interactive collapsible content component for terminal interface
// ABOUTME: Supports keyboard navigation and customizable styling for event details

import React from 'react';
import { Box, Text } from 'ink';

interface CollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  summary?: React.ReactNode; // Content to show when collapsed
  isExpanded: boolean; // Controlled state from parent
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round' | 'classic' | 'bold' | 'arrow';
  borderColor?: string;
  isFocused?: boolean; // Whether this specific box is focused (for visual indication)
}

export function CollapsibleBox({ 
  children, 
  label, 
  summary,
  isExpanded,
  maxHeight,
  borderStyle = 'round',
  borderColor = 'gray',
  isFocused = false
}: CollapsibleBoxProps) {
  
  return (
    <Box flexDirection="column">
      {label && (
        <Box>
          <Text color={borderColor}>
            {isExpanded ? '▼' : '▶'} {label}
          </Text>
          {isFocused && (
            <Text color="gray"> (← → to toggle)</Text>
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
