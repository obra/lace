// ABOUTME: File path autocomplete component with focus management
// ABOUTME: Focusable autocomplete that handles its own keyboard input and navigation

import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useLaceFocus, FocusRegions, useLaceFocusContext } from '../focus/index.js';

interface FileAutocompleteProps {
  items: string[];
  selectedIndex: number;
  isVisible: boolean;
  maxItems?: number;
  onSelect?: (item: string) => void;
  onCancel?: () => void;
  onNavigate?: (direction: 'up' | 'down') => void;
}

const FileAutocomplete: React.FC<FileAutocompleteProps> = ({
  items,
  selectedIndex,
  isVisible,
  maxItems = 5,
  onSelect,
  onCancel,
  onNavigate,
}) => {
  const { isFocused, takeFocus } = useLaceFocus(FocusRegions.autocomplete);
  const { pushFocus } = useLaceFocusContext();

  // Take focus when becoming visible
  useEffect(() => {
    if (isVisible && items.length > 0) {
      takeFocus();
    }
  }, [isVisible, items.length, takeFocus]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isFocused) return;

      if (key.escape) {
        onCancel?.();
        // Return focus to shell input when canceling autocomplete
        pushFocus(FocusRegions.shell);
        return;
      }

      if (key.return || key.tab || key.rightArrow) {
        // Select the current item
        const selectedItem = items[selectedIndex];
        if (selectedItem && onSelect) {
          onSelect(selectedItem);
        }
        // Return focus to shell input after selection
        pushFocus(FocusRegions.shell);
        return;
      }

      if (key.upArrow) {
        onNavigate?.('up');
        return;
      }

      if (key.downArrow) {
        onNavigate?.('down');
        return;
      }
    },
    { isActive: isFocused }
  );

  if (!isVisible || items.length === 0) {
    return null;
  }

  // Calculate visible window for scrolling - keep selected item at top
  const startIndex = Math.max(0, Math.min(selectedIndex, items.length - maxItems));
  const endIndex = Math.min(items.length, startIndex + maxItems);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, index) => {
        const actualIndex = startIndex + index;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Text
            key={`${actualIndex}-${item}`}
            color={isSelected ? 'yellow' : 'dim'}
            backgroundColor={isFocused && isSelected ? 'blue' : undefined}
          >
            {isSelected ? '> ' : '  '}
            {item.trim()}
          </Text>
        );
      })}
    </Box>
  );
};

export default FileAutocomplete;
