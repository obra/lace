// ABOUTME: Interactive collapsible content component for terminal interface
// ABOUTME: Supports keyboard navigation and customizable styling for event details

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface CollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  defaultExpanded?: boolean;
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round';
  borderColor?: string;
}

export function CollapsibleBox({ 
  children, 
  label, 
  defaultExpanded = true,
  maxHeight,
  borderStyle = 'single',
  borderColor = 'gray'
}: CollapsibleBoxProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  useInput((input, key) => {
    if (key.return && label) {
      setIsExpanded(!isExpanded);
    }
  });
  
  return (
    <Box flexDirection="column">
      {label && (
        <Box>
          <Text color={borderColor}>
            {isExpanded ? '▼' : '▶'} {label}
          </Text>
          <Text color="gray"> (press Enter to toggle)</Text>
        </Box>
      )}
      
      {isExpanded && (
        <Box 
          borderStyle={borderStyle}
          borderColor={borderColor}
          flexDirection="column"
          height={maxHeight}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}