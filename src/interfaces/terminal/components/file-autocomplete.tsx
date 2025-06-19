// ABOUTME: File path autocomplete display component
// ABOUTME: Shows file/directory completion list with highlighting for selected item

import React from 'react';
import { Box, Text } from 'ink';

interface FileAutocompleteProps {
  items: string[];
  selectedIndex: number;
  isVisible: boolean;
  maxItems?: number;
}

const FileAutocomplete: React.FC<FileAutocompleteProps> = ({
  items,
  selectedIndex,
  isVisible,
  maxItems = 5
}) => {
  if (!isVisible || items.length === 0) {
    return null;
  }

  // Calculate visible window for scrolling
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxItems / 2), items.length - maxItems));
  const endIndex = Math.min(items.length, startIndex + maxItems);
  const visibleItems = items.slice(startIndex, endIndex);
  const hasMore = items.length > maxItems;

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, index) => {
        const actualIndex = startIndex + index;
        const isSelected = actualIndex === selectedIndex;
        
        return (
          <Text 
            key={`${actualIndex}-${item}`}
            color={isSelected ? "black" : "white"}
            backgroundColor={isSelected ? "white" : undefined}
          >
            {isSelected ? '> ' : '  '}{item}
          </Text>
        );
      })}
    </Box>
  );
};

export default FileAutocomplete;
