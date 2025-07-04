// ABOUTME: State management layer for tool renderers - handles expansion, focus, and interaction states
// ABOUTME: Provides consistent behavior across all tool renderers with reusable state patterns

import { useCallback } from 'react';
import { useTimelineItemExpansion } from '../../hooks/useTimelineExpansionToggle.js';

// Tool state interface
export interface ToolState {
  // Expansion state
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  handleExpandedChange: (expanded: boolean) => void;
}

// Main state hook for tool renderers
export function useToolState(isSelected: boolean = false, onToggle?: () => void): ToolState {
  // Use shared expansion management
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected, () =>
    onToggle?.()
  );

  // Create handler that works with TimelineEntry interface
  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      if (expanded) {
        onExpand();
      } else {
        onCollapse();
      }
    },
    [onExpand, onCollapse]
  );

  return {
    isExpanded,
    onExpand,
    onCollapse,
    handleExpandedChange,
  };
}
