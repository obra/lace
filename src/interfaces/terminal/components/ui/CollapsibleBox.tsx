// ABOUTME: Interactive collapsible content component for terminal interface
// ABOUTME: Supports keyboard navigation and customizable styling for event details

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface CollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  summary?: React.ReactNode; // Content to show when collapsed
  defaultExpanded?: boolean;
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round';
  borderColor?: string;
  isFocused?: boolean; // Whether this specific box is focused
  onToggle?: () => void; // Called when expanded/collapsed to trigger height re-measurement
}

export function CollapsibleBox({ 
  children, 
  label, 
  summary,
  defaultExpanded = true,
  maxHeight,
  borderStyle = 'single',
  borderColor = 'gray',
  isFocused = false,
  onToggle
}: CollapsibleBoxProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  useInput((input, key) => {
    if (key.return && label) {
      setIsExpanded(!isExpanded);
      onToggle?.(); // Notify parent of height change
    }
  }, { isActive: isFocused });
  
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